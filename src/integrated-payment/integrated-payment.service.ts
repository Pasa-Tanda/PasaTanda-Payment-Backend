import { Injectable, Logger } from '@nestjs/common';
import { X402PaymentService } from '../x402/services/x402-payment.service';
import { SorobanService } from '../soroban/soroban.service';
import { X402PaymentJob } from '../x402/types';

/**
 * Integrated Payment Service
 * 
 * Orchestrates the complete payment flow according to PasaTanda_payment_flow.md:
 * 1. User pays via X402 (fiat QR or crypto wallet)
 * 2. Backend verifies payment
 * 3. Backend invokes deposit_for on PasanakuGroup contract
 * 4. Funds auto-invest in Blend Pool
 * 5. On round completion, payout to winner
 * 6. Platform sweeps yield earnings
 */
@Injectable()
export class IntegratedPaymentService {
  private readonly logger = new Logger(IntegratedPaymentService.name);

  constructor(
    private readonly x402Service: X402PaymentService,
    private readonly sorobanService: SorobanService,
  ) {}

  /**
   * Process a confirmed payment and register it in the smart contract
   * Called after X402 payment is verified and settled
   * 
   * @param jobId - X402 payment job ID
   * @param groupAddress - PasanakuGroup contract address
   * @param memberAddress - Member Stellar address
   */
  async registerPaymentOnChain(
    jobId: string,
    groupAddress: string,
    memberAddress: string,
  ): Promise<{
    success: boolean;
    txHash?: string;
    error?: string;
  }> {
    const job = this.x402Service.getJobStatus(jobId);
    
    if (!job) {
      return {
        success: false,
        error: `Payment job ${jobId} not found`,
      };
    }

    if (job.status !== 'settled' && job.status !== 'completed') {
      return {
        success: false,
        error: `Payment job ${jobId} is not settled. Status: ${job.status}`,
      };
    }

    // Convert USD amount to stroops (assuming 1:1 USD:USDC)
    const amountStroops = BigInt(Math.floor(job.amountUsd * 10_000_000)).toString();

    this.logger.log(
      `Registering payment on-chain: Job=${jobId}, Group=${groupAddress}, Member=${memberAddress}, Amount=${amountStroops}`,
    );

    // Invoke deposit_for on the smart contract
    const result = await this.sorobanService.depositFor(
      groupAddress,
      memberAddress,
      amountStroops,
    );

    if (result.success) {
      this.logger.log(
        `Payment registered on-chain successfully: TX=${result.txHash}`,
      );
      
      // You could update the job with contract tx hash here if needed
      // job.contractTxHash = result.txHash;
    } else {
      this.logger.error(
        `Failed to register payment on-chain: ${result.error}`,
      );
    }

    return result;
  }

  /**
   * Execute payout to round winner
   * Called when round is complete and winner is selected
   * 
   * @param groupAddress - PasanakuGroup contract address
   * @param winnerAddress - Winner Stellar address
   */
  async executeRoundPayout(
    groupAddress: string,
    winnerAddress: string,
  ): Promise<{
    success: boolean;
    txHash?: string;
    error?: string;
  }> {
    this.logger.log(
      `Executing round payout: Group=${groupAddress}, Winner=${winnerAddress}`,
    );

    const result = await this.sorobanService.payout(groupAddress, winnerAddress);

    if (result.success) {
      this.logger.log(
        `Round payout successful: TX=${result.txHash}`,
      );
      
      // Automatically sweep yield after payout
      await this.sweepPlatformYield(groupAddress);
    } else {
      this.logger.error(
        `Failed to execute round payout: ${result.error}`,
      );
    }

    return result;
  }

  /**
   * Sweep platform yield earnings
   * Called after each payout to collect platform share of Blend yield
   * 
   * @param groupAddress - PasanakuGroup contract address
   * @param treasuryAddress - Optional treasury address (defaults to admin)
   */
  async sweepPlatformYield(
    groupAddress: string,
    treasuryAddress?: string,
  ): Promise<{
    success: boolean;
    txHash?: string;
    amount?: string;
    error?: string;
  }> {
    this.logger.log(
      `Sweeping platform yield: Group=${groupAddress}`,
    );

    const result = await this.sorobanService.sweepYield(
      groupAddress,
      treasuryAddress,
    );

    if (result.success) {
      this.logger.log(
        `Platform yield swept successfully: TX=${result.txHash}`,
      );
    } else {
      // Don't log error if there's simply no yield to sweep
      if (result.error && !result.error.includes('no yield') && !result.error.includes('zero')) {
        this.logger.warn(
          `Failed to sweep platform yield: ${result.error}`,
        );
      }
    }

    return result;
  }

  /**
   * Get group status with payment job correlation
   * Useful for displaying group info to users
   * 
   * @param groupAddress - PasanakuGroup contract address
   */
  async getGroupStatus(groupAddress: string): Promise<{
    config: any;
    members: any[];
    currentRound: number;
    estimatedYield: string;
  }> {
    const [config, members, currentRound, estimatedYield] = await Promise.all([
      this.sorobanService.getGroupConfig(groupAddress),
      this.sorobanService.getMembers(groupAddress),
      this.sorobanService.getCurrentRound(groupAddress),
      this.sorobanService.getEstimatedYield(groupAddress),
    ]);

    return {
      config,
      members,
      currentRound,
      estimatedYield,
    };
  }

  /**
   * Complete payment flow:
   * 1. User initiates payment via X402
   * 2. Payment is verified and settled
   * 3. Automatically register payment in smart contract
   * 
   * This is a convenience method that combines X402 payment processing
   * with on-chain registration.
   */
  async processAndRegisterPayment(
    jobId: string,
    xPaymentHeader: string,
    groupAddress: string,
    memberAddress: string,
  ): Promise<{
    paymentSuccess: boolean;
    onChainSuccess: boolean;
    paymentTxHash?: string;
    contractTxHash?: string;
    error?: string;
  }> {
    // Step 1: Process X402 payment
    const paymentResult = await this.x402Service.processPayment(
      jobId,
      xPaymentHeader,
    );

    if (!paymentResult.success) {
      return {
        paymentSuccess: false,
        onChainSuccess: false,
        error: paymentResult.error,
      };
    }

    // Step 2: Register payment on-chain
    const onChainResult = await this.registerPaymentOnChain(
      jobId,
      groupAddress,
      memberAddress,
    );

    return {
      paymentSuccess: paymentResult.success,
      onChainSuccess: onChainResult.success,
      paymentTxHash: paymentResult.txHash,
      contractTxHash: onChainResult.txHash,
      error: onChainResult.error,
    };
  }
}
