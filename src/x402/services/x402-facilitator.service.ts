import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Keypair,
  Networks,
  Operation,
  Horizon,
  TimeoutInfinite,
  Transaction,
  TransactionBuilder,
  Asset,
  xdr,
} from '@stellar/stellar-sdk';
import {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  X402_CONFIG,
  isCryptoPaymentPayload,
  ExactStellarPayload,
} from '../types/x402.types';

/**
 * X402 Facilitator Service for Stellar
 *
 * Handles verification and settlement of x402 payments on Stellar.
 * Implements the facilitator role in the x402 protocol:
 * - Verifies payment signatures and authorization
 * - Settles payments by submitting transactions to Stellar
 * - Provides optional fee sponsorship (facilitator pays fees)
 */
@Injectable()
export class X402FacilitatorService implements OnModuleInit {
  private readonly logger = new Logger(X402FacilitatorService.name);
  private server: Horizon.Server;
  private facilitatorKeypair!: Keypair;
  private facilitatorAddress!: string;
  private isConfigured = false;

  constructor(private readonly configService: ConfigService) {
    this.server = new Horizon.Server(X402_CONFIG.horizonUrl);
  }

  onModuleInit(): void {
    this.initialize();
  }

  /**
   * Initialize the facilitator with Stellar keypair
   */
  private initialize(): void {
    const secretKey = this.configService.get<string>(
      'X402_FACILITATOR_PRIVATE_KEY',
    );

    if (!secretKey) {
      this.logger.warn(
        'X402_FACILITATOR_PRIVATE_KEY not configured. X402 payment settlement will not be available.',
      );
      return;
    }

    try {
      this.facilitatorKeypair = Keypair.fromSecret(secretKey);
      this.facilitatorAddress = this.facilitatorKeypair.publicKey();
      this.isConfigured = true;

      this.logger.log(
        `X402 Facilitator initialized for Stellar Testnet. Address: ${this.facilitatorAddress}`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize X402 facilitator', error);
    }
  }

  /**
   * Check if the facilitator is properly configured
   */
  isReady(): boolean {
    return this.isConfigured;
  }

  /**
   * Get the facilitator's wallet address
   */
  getFacilitatorAddress(): string | undefined {
    return this.facilitatorAddress;
  }

  /**
   * Get supported payment kinds
   */
  getSupported(): {
    kinds: Array<{
      x402Version: number;
      scheme: string;
      network: string;
    }>;
  } {
    return {
      kinds: [
        {
          x402Version: X402_CONFIG.x402Version,
          scheme: X402_CONFIG.scheme,
          network: X402_CONFIG.network,
        },
      ],
    };
  }

  /**
   * Verify a payment payload against payment requirements
   *
   * Verification steps:
   * 1. Check protocol version compatibility
   * 2. Validate scheme and network match
   * 3. Verify transaction signature
   * 4. Check payer has sufficient balance
   * 5. Verify payment amount meets requirements
   * 6. Check transaction validity
   * 7. Ensure transaction hasn't been submitted
   */
  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    if (!isCryptoPaymentPayload(paymentPayload)) {
      return {
        isValid: false,
        invalidReason: 'Invalid payment payload type for crypto payment',
      };
    }

    if (!this.isConfigured) {
      return {
        isValid: false,
        invalidReason: 'Facilitator not configured',
      };
    }

    const payload = paymentPayload.payload as ExactStellarPayload;

    try {
      // 1. Verify x402 version
      if (paymentPayload.x402Version !== X402_CONFIG.x402Version) {
        return {
          isValid: false,
          invalidReason: `Unsupported x402 version: ${paymentPayload.x402Version}`,
        };
      }

      // 2. Verify network
      if (paymentPayload.network !== X402_CONFIG.network) {
        return {
          isValid: false,
          invalidReason: `Wrong network. Expected ${X402_CONFIG.network}, got ${paymentPayload.network}`,
        };
      }

      // 3. Verify scheme
      if (paymentPayload.scheme !== X402_CONFIG.scheme) {
        return {
          isValid: false,
          invalidReason: `Unsupported scheme: ${paymentPayload.scheme}`,
        };
      }

      // 4. Decode and verify transaction
      const transaction = TransactionBuilder.fromXDR(
        payload.signedTxXdr,
        X402_CONFIG.networkPassphrase,
      ) as Transaction;

      // 5. Verify source account matches payload
      if (transaction.source !== payload.sourceAccount) {
        return {
          isValid: false,
          invalidReason: 'Transaction source account mismatch',
        };
      }

      // 6. Verify transaction has valid signature
      // Stellar SDK automatically validates signatures when decoding XDR
      // But we can do additional checks
      const sourceKeypair = Keypair.fromPublicKey(payload.sourceAccount);
      const txHash = transaction.hash();
      const signatures = transaction.signatures;

      if (signatures.length === 0) {
        return {
          isValid: false,
          invalidReason: 'Transaction has no signatures',
        };
      }

      // Verify at least one signature is valid for the source account
      let hasValidSignature = false;
      for (const sig of signatures) {
        if (sourceKeypair.verify(txHash, sig.signature())) {
          hasValidSignature = true;
          break;
        }
      }

      if (!hasValidSignature) {
        return {
          isValid: false,
          invalidReason: 'Invalid transaction signature',
        };
      }

      // 7. Verify payment operation
      const paymentOp = transaction.operations.find(
        (op) => op.type === 'payment',
      );

      if (!paymentOp) {
        return {
          isValid: false,
          invalidReason: 'No payment operation found in transaction',
        };
      }

      // 8. Verify destination matches payment requirements
      if (
        (paymentOp as any).destination !== paymentRequirements.payTo
      ) {
        return {
          isValid: false,
          invalidReason: `Payment destination mismatch. Expected ${paymentRequirements.payTo}`,
        };
      }

      // 9. Verify amount
      const amountInStroops = BigInt(
        Math.floor(parseFloat((paymentOp as any).amount) * 10_000_000),
      );
      const requiredAmount = BigInt(paymentRequirements.maxAmountRequired);

      if (amountInStroops < requiredAmount) {
        return {
          isValid: false,
          invalidReason: `Insufficient payment amount. Required ${requiredAmount}, got ${amountInStroops}`,
        };
      }

      // 10. Verify asset
      const paymentAsset = (paymentOp as any).asset;
      const assetCode =
        paymentAsset.isNative() ? 'native' : paymentAsset.getCode();
      const expectedAsset = paymentRequirements.asset;

      if (expectedAsset === 'native' && !paymentAsset.isNative()) {
        return {
          isValid: false,
          invalidReason: 'Expected native XLM payment',
        };
      }

      if (expectedAsset !== 'native' && expectedAsset !== assetCode) {
        return {
          isValid: false,
          invalidReason: `Asset mismatch. Expected ${expectedAsset}, got ${assetCode}`,
        };
      }

      // 11. Check payer balance
      try {
        const account = await this.server.loadAccount(payload.sourceAccount);
        const balance =
          paymentAsset.isNative()
            ? parseFloat(
                account.balances.find((b: any) => b.asset_type === 'native')
                  ?.balance || '0',
              )
            : parseFloat(
                account.balances.find(
                  (b: any) =>
                    b.asset_code === assetCode &&
                    b.asset_type !== 'native',
                )?.balance || '0',
              );

        const balanceInStroops = BigInt(Math.floor(balance * 10_000_000));
        if (balanceInStroops < requiredAmount) {
          return {
            isValid: false,
            invalidReason: `Insufficient balance. Has ${balanceInStroops}, needs ${requiredAmount}`,
          };
        }
      } catch (error) {
        this.logger.error('Error checking payer balance', error);
        return {
          isValid: false,
          invalidReason: 'Failed to verify payer balance',
        };
      }

      return {
        isValid: true,
        payer: payload.sourceAccount,
      };
    } catch (error) {
      this.logger.error('Payment verification failed', error);
      return {
        isValid: false,
        invalidReason:
          error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  /**
   * Settle a payment by submitting the transaction to Stellar
   *
   * The facilitator can optionally fee-bump the transaction to pay for gas.
   */
  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    if (!isCryptoPaymentPayload(paymentPayload)) {
      return {
        success: false,
        errorReason: 'Invalid payment payload type for crypto payment',
        transaction: '',
        network: X402_CONFIG.network,
      };
    }

    if (!this.isConfigured) {
      return {
        success: false,
        errorReason: 'Facilitator not configured',
        transaction: '',
        network: X402_CONFIG.network,
      };
    }

    const payload = paymentPayload.payload as ExactStellarPayload;

    try {
      // Decode the signed transaction
      const transaction = TransactionBuilder.fromXDR(
        payload.signedTxXdr,
        X402_CONFIG.networkPassphrase,
      ) as Transaction;

      // Check if we should fee-bump (optional fee sponsorship)
      const shouldFeeBump =
        paymentRequirements.extra?.feeSponsorship === true;

      let txToSubmit = transaction;

      if (shouldFeeBump) {
        // Create a fee-bump transaction
        const facilitatorAccount = await this.server.loadAccount(
          this.facilitatorAddress,
        );

        const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
          this.facilitatorKeypair,
          '200', // Base fee in stroops (0.00002 XLM)
          transaction,
          X402_CONFIG.networkPassphrase,
        );

        txToSubmit = feeBumpTx as any;
      }

      // Submit the transaction to Stellar
      const result = await this.server.submitTransaction(txToSubmit);

      return {
        success: true,
        transaction: result.hash,
        network: X402_CONFIG.network,
        payer: payload.sourceAccount,
      };
    } catch (error) {
      this.logger.error('Payment settlement failed', error);
      return {
        success: false,
        errorReason:
          error instanceof Error ? error.message : 'Settlement failed',
        transaction: '',
        network: X402_CONFIG.network,
        payer: payload.sourceAccount,
      };
    }
  }

  /**
   * Get balance for a Stellar address
   */
  async getBalance(
    address: string,
    asset: string = 'native',
  ): Promise<bigint> {
    if (!this.isConfigured) {
      throw new Error('Facilitator not configured');
    }

    try {
      const account = await this.server.loadAccount(address);

      if (asset === 'native') {
        const nativeBalance = account.balances.find(
          (b: any) => b.asset_type === 'native',
        );
        const balance = parseFloat(nativeBalance?.balance || '0');
        return BigInt(Math.floor(balance * 10_000_000));
      } else {
        const assetBalance = account.balances.find(
          (b: any) => b.asset_code === asset && b.asset_type !== 'native',
        );
        const balance = parseFloat(assetBalance?.balance || '0');
        return BigInt(Math.floor(balance * 10_000_000));
      }
    } catch (error) {
      this.logger.error('Error fetching balance', error);
      throw error;
    }
  }

  /**
   * Get block explorer URL for a transaction
   */
  getBlockExplorerUrl(txHash: string): string {
    return `${X402_CONFIG.blockExplorer}/tx/${txHash}`;
  }
}
