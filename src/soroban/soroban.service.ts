import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Keypair,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Operation,
  Address,
  xdr,
  scValToNative,
  nativeToScVal,
  TimeoutInfinite,
} from '@stellar/stellar-sdk';

/**
 * Soroban Service for PasaTanda Smart Contracts
 * 
 * Integrates with deployed PasanakuGroup and PasanakuFactory contracts
 * on Stellar Testnet to handle:
 * - deposit_for: Register member payments
 * - payout: Distribute funds to round winner
 * - create_group: Deploy new pasanaku groups
 * - Query functions: get_members, get_config, etc.
 */
@Injectable()
export class SorobanService implements OnModuleInit {
  private readonly logger = new Logger(SorobanService.name);
  
  private server!: SorobanRpc.Server;
  private adminKeypair!: Keypair;
  private adminAddress!: string;
  
  // Contract addresses from DEPLOYED_CONTRACTS.md
  private readonly FACTORY_ADDRESS = 'CCYLAWPJM6OVZ222HLPZBE5VLP5HYS43575LI4SCYMGC35JFL2DQUSGD';
  private readonly GROUP_WASM_HASH = '091f6b66a1bf7192bff0ec84e32c5f2f32c4c77ef1bd742a6d3b8d2a67804ea6';
  
  // USDC on Stellar Testnet
  private readonly USDC_ADDRESS = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
  
  // Blend Pool address (to be configured)
  private readonly BLEND_POOL_ADDRESS = process.env.BLEND_POOL_ADDRESS || '';
  
  private isConfigured = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  /**
   * Initialize Soroban RPC connection and admin keypair
   */
  private async initialize(): Promise<void> {
    const rpcUrl = this.configService.get<string>('SOROBAN_RPC_URL') || 
                   'https://soroban-testnet.stellar.org';
    
    this.server = new SorobanRpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith('http://'),
    });

    const adminSecretKey = this.configService.get<string>('SOROBAN_ADMIN_SECRET_KEY');
    
    if (!adminSecretKey) {
      this.logger.warn(
        'SOROBAN_ADMIN_SECRET_KEY not configured. Soroban contract invocations will not be available.',
      );
      return;
    }

    try {
      this.adminKeypair = Keypair.fromSecret(adminSecretKey);
      this.adminAddress = this.adminKeypair.publicKey();
      this.isConfigured = true;

      this.logger.log(
        `Soroban service initialized for Stellar Testnet. Admin: ${this.adminAddress}`,
      );
      
      // Log contract addresses
      this.logger.log(`Factory Address: ${this.FACTORY_ADDRESS}`);
      this.logger.log(`USDC Address: ${this.USDC_ADDRESS}`);
      
      if (this.BLEND_POOL_ADDRESS) {
        this.logger.log(`Blend Pool Address: ${this.BLEND_POOL_ADDRESS}`);
      } else {
        this.logger.warn('BLEND_POOL_ADDRESS not configured. Yield generation will be disabled.');
      }
    } catch (error) {
      this.logger.error('Failed to initialize Soroban service', error);
    }
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return this.isConfigured;
  }

  /**
   * Get admin address
   */
  getAdminAddress(): string | undefined {
    return this.adminAddress;
  }

  /**
   * Create a new PasanakuGroup
   * 
   * @param members - Array of Stellar addresses (G...)
   * @param amountPerRound - Amount in stroops (7 decimals)
   * @param frequencyDays - Payment frequency in days
   * @param enableYield - Whether to enable Blend yield
   * @param yieldShareBps - Basis points for yield distribution (e.g., 7000 = 70%)
   */
  async createGroup(
    members: string[],
    amountPerRound: string,
    frequencyDays: number,
    enableYield = true,
    yieldShareBps = 7000,
  ): Promise<{
    success: boolean;
    groupAddress?: string;
    txHash?: string;
    error?: string;
  }> {
    if (!this.isConfigured) {
      return { success: false, error: 'Soroban service not configured' };
    }

    try {
      const factoryContract = new Contract(this.FACTORY_ADDRESS);
      
      // Generate unique salt for deterministic address
      const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
      
      // Build CreateGroupParams struct
      const params = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: nativeToScVal('admin', { type: 'symbol' }),
          val: new Address(this.adminAddress).toScVal(),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('token', { type: 'symbol' }),
          val: new Address(this.USDC_ADDRESS).toScVal(),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('amount_per_round', { type: 'symbol' }),
          val: nativeToScVal(amountPerRound, { type: 'i128' }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('frequency_days', { type: 'symbol' }),
          val: nativeToScVal(frequencyDays, { type: 'u32' }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('members', { type: 'symbol' }),
          val: nativeToScVal(members.map(addr => new Address(addr)), { type: 'vec' }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('yield_enabled', { type: 'symbol' }),
          val: nativeToScVal(enableYield, { type: 'bool' }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('yield_share_bps', { type: 'symbol' }),
          val: nativeToScVal(yieldShareBps, { type: 'u32' }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('blend_pool_address', { type: 'symbol' }),
          val: new Address(this.BLEND_POOL_ADDRESS).toScVal(),
        }),
      ]);

      // Load account
      const sourceAccount = await this.server.getAccount(this.adminAddress);

      // Build transaction
      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          factoryContract.call(
            'create_group',
            params,
            nativeToScVal(salt, { type: 'bytes' }),
          ),
        )
        .setTimeout(TimeoutInfinite)
        .build();

      // Simulate first
      const simulationResponse = await this.server.simulateTransaction(transaction);
      
      if (SorobanRpc.Api.isSimulationError(simulationResponse)) {
        throw new Error(`Simulation failed: ${simulationResponse.error}`);
      }

      // Prepare and sign
      const preparedTx = SorobanRpc.assembleTransaction(
        transaction,
        simulationResponse,
      ).build();
      
      preparedTx.sign(this.adminKeypair);

      // Submit
      const sendResponse = await this.server.sendTransaction(preparedTx);
      
      if (sendResponse.status === 'PENDING') {
        // Wait for confirmation
        let getResponse = await this.server.getTransaction(sendResponse.hash);
        
        while (getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          getResponse = await this.server.getTransaction(sendResponse.hash);
        }

        if (getResponse.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          // Extract group address from result
          const result = getResponse.returnValue;
          const groupAddress = result ? Address.fromScVal(result).toString() : undefined;

          return {
            success: true,
            groupAddress,
            txHash: sendResponse.hash,
          };
        }
      }

      return {
        success: false,
        error: 'Transaction failed',
      };
    } catch (error) {
      this.logger.error('Failed to create group', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Deposit payment for a member
   * Invokes: deposit_for(from: Address, beneficiary: Address, amount: i128)
   * 
   * @param groupAddress - PasanakuGroup contract address
   * @param beneficiary - Member address making payment
   * @param amount - Amount in stroops
   */
  async depositFor(
    groupAddress: string,
    beneficiary: string,
    amount: string,
  ): Promise<{
    success: boolean;
    txHash?: string;
    error?: string;
  }> {
    if (!this.isConfigured) {
      return { success: false, error: 'Soroban service not configured' };
    }

    try {
      const groupContract = new Contract(groupAddress);
      
      // Load account
      const sourceAccount = await this.server.getAccount(this.adminAddress);

      // Build transaction
      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          groupContract.call(
            'deposit_for',
            new Address(this.adminAddress).toScVal(),     // from (Admin/PayBE)
            new Address(beneficiary).toScVal(),            // beneficiary
            nativeToScVal(amount, { type: 'i128' }),      // amount
          ),
        )
        .setTimeout(TimeoutInfinite)
        .build();

      // Simulate
      const simulationResponse = await this.server.simulateTransaction(transaction);
      
      if (SorobanRpc.Api.isSimulationError(simulationResponse)) {
        throw new Error(`Simulation failed: ${simulationResponse.error}`);
      }

      // Prepare and sign
      const preparedTx = SorobanRpc.assembleTransaction(
        transaction,
        simulationResponse,
      ).build();
      
      preparedTx.sign(this.adminKeypair);

      // Submit
      const sendResponse = await this.server.sendTransaction(preparedTx);
      
      if (sendResponse.status === 'PENDING') {
        // Wait for confirmation
        let getResponse = await this.server.getTransaction(sendResponse.hash);
        
        while (getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          getResponse = await this.server.getTransaction(sendResponse.hash);
        }

        if (getResponse.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(
            `deposit_for successful: ${sendResponse.hash} | Beneficiary: ${beneficiary} | Amount: ${amount}`,
          );

          return {
            success: true,
            txHash: sendResponse.hash,
          };
        }
      }

      return {
        success: false,
        error: 'Transaction failed',
      };
    } catch (error) {
      this.logger.error('Failed to deposit for member', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute payout to round winner
   * Invokes: payout(winner: Address)
   * 
   * @param groupAddress - PasanakuGroup contract address
   * @param winner - Winner address
   */
  async payout(
    groupAddress: string,
    winner: string,
  ): Promise<{
    success: boolean;
    txHash?: string;
    amount?: string;
    error?: string;
  }> {
    if (!this.isConfigured) {
      return { success: false, error: 'Soroban service not configured' };
    }

    try {
      const groupContract = new Contract(groupAddress);
      
      // Load account
      const sourceAccount = await this.server.getAccount(this.adminAddress);

      // Build transaction
      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          groupContract.call(
            'payout',
            new Address(winner).toScVal(),
          ),
        )
        .setTimeout(TimeoutInfinite)
        .build();

      // Simulate
      const simulationResponse = await this.server.simulateTransaction(transaction);
      
      if (SorobanRpc.Api.isSimulationError(simulationResponse)) {
        throw new Error(`Simulation failed: ${simulationResponse.error}`);
      }

      // Prepare and sign
      const preparedTx = SorobanRpc.assembleTransaction(
        transaction,
        simulationResponse,
      ).build();
      
      preparedTx.sign(this.adminKeypair);

      // Submit
      const sendResponse = await this.server.sendTransaction(preparedTx);
      
      if (sendResponse.status === 'PENDING') {
        // Wait for confirmation
        let getResponse = await this.server.getTransaction(sendResponse.hash);
        
        while (getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          getResponse = await this.server.getTransaction(sendResponse.hash);
        }

        if (getResponse.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(
            `payout successful: ${sendResponse.hash} | Winner: ${winner}`,
          );

          return {
            success: true,
            txHash: sendResponse.hash,
          };
        }
      }

      return {
        success: false,
        error: 'Transaction failed',
      };
    } catch (error) {
      this.logger.error('Failed to execute payout', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sweep yield (platform earnings) to treasury
   * Invokes: admin_sweep_yield(to: Address)
   * 
   * @param groupAddress - PasanakuGroup contract address
   * @param treasuryAddress - Platform treasury address
   */
  async sweepYield(
    groupAddress: string,
    treasuryAddress?: string,
  ): Promise<{
    success: boolean;
    txHash?: string;
    amount?: string;
    error?: string;
  }> {
    if (!this.isConfigured) {
      return { success: false, error: 'Soroban service not configured' };
    }

    const treasury = treasuryAddress || this.adminAddress;

    try {
      const groupContract = new Contract(groupAddress);
      
      // Load account
      const sourceAccount = await this.server.getAccount(this.adminAddress);

      // Build transaction
      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          groupContract.call(
            'admin_sweep_yield',
            new Address(treasury).toScVal(),
          ),
        )
        .setTimeout(TimeoutInfinite)
        .build();

      // Simulate
      const simulationResponse = await this.server.simulateTransaction(transaction);
      
      if (SorobanRpc.Api.isSimulationError(simulationResponse)) {
        throw new Error(`Simulation failed: ${simulationResponse.error}`);
      }

      // Prepare and sign
      const preparedTx = SorobanRpc.assembleTransaction(
        transaction,
        simulationResponse,
      ).build();
      
      preparedTx.sign(this.adminKeypair);

      // Submit
      const sendResponse = await this.server.sendTransaction(preparedTx);
      
      if (sendResponse.status === 'PENDING') {
        // Wait for confirmation
        let getResponse = await this.server.getTransaction(sendResponse.hash);
        
        while (getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          getResponse = await this.server.getTransaction(sendResponse.hash);
        }

        if (getResponse.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(
            `sweep_yield successful: ${sendResponse.hash} | Treasury: ${treasury}`,
          );

          return {
            success: true,
            txHash: sendResponse.hash,
          };
        }
      }

      return {
        success: false,
        error: 'Transaction failed',
      };
    } catch (error) {
      this.logger.error('Failed to sweep yield', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Query group configuration
   */
  async getGroupConfig(groupAddress: string): Promise<any> {
    if (!this.isConfigured) {
      throw new Error('Soroban service not configured');
    }

    try {
      const groupContract = new Contract(groupAddress);
      const sourceAccount = await this.server.getAccount(this.adminAddress);

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(groupContract.call('get_config'))
        .setTimeout(TimeoutInfinite)
        .build();

      const simulationResponse = await this.server.simulateTransaction(transaction);
      
      if (SorobanRpc.Api.isSimulationError(simulationResponse)) {
        throw new Error(`Simulation failed: ${simulationResponse.error}`);
      }

      if (simulationResponse.result) {
        return scValToNative(simulationResponse.result.retval);
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to get group config', error);
      throw error;
    }
  }

  /**
   * Query group members status
   */
  async getMembers(groupAddress: string): Promise<any[]> {
    if (!this.isConfigured) {
      throw new Error('Soroban service not configured');
    }

    try {
      const groupContract = new Contract(groupAddress);
      const sourceAccount = await this.server.getAccount(this.adminAddress);

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(groupContract.call('get_members'))
        .setTimeout(TimeoutInfinite)
        .build();

      const simulationResponse = await this.server.simulateTransaction(transaction);
      
      if (SorobanRpc.Api.isSimulationError(simulationResponse)) {
        throw new Error(`Simulation failed: ${simulationResponse.error}`);
      }

      if (simulationResponse.result) {
        return scValToNative(simulationResponse.result.retval);
      }

      return [];
    } catch (error) {
      this.logger.error('Failed to get members', error);
      throw error;
    }
  }

  /**
   * Get current round number
   */
  async getCurrentRound(groupAddress: string): Promise<number> {
    if (!this.isConfigured) {
      throw new Error('Soroban service not configured');
    }

    try {
      const groupContract = new Contract(groupAddress);
      const sourceAccount = await this.server.getAccount(this.adminAddress);

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(groupContract.call('get_current_round'))
        .setTimeout(TimeoutInfinite)
        .build();

      const simulationResponse = await this.server.simulateTransaction(transaction);
      
      if (SorobanRpc.Api.isSimulationError(simulationResponse)) {
        throw new Error(`Simulation failed: ${simulationResponse.error}`);
      }

      if (simulationResponse.result) {
        return scValToNative(simulationResponse.result.retval) as number;
      }

      return 0;
    } catch (error) {
      this.logger.error('Failed to get current round', error);
      throw error;
    }
  }

  /**
   * Get estimated yield
   */
  async getEstimatedYield(groupAddress: string): Promise<string> {
    if (!this.isConfigured) {
      throw new Error('Soroban service not configured');
    }

    try {
      const groupContract = new Contract(groupAddress);
      const sourceAccount = await this.server.getAccount(this.adminAddress);

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(groupContract.call('get_estimated_yield'))
        .setTimeout(TimeoutInfinite)
        .build();

      const simulationResponse = await this.server.simulateTransaction(transaction);
      
      if (SorobanRpc.Api.isSimulationError(simulationResponse)) {
        throw new Error(`Simulation failed: ${simulationResponse.error}`);
      }

      if (simulationResponse.result) {
        return scValToNative(simulationResponse.result.retval) as string;
      }

      return '0';
    } catch (error) {
      this.logger.error('Failed to get estimated yield', error);
      throw error;
    }
  }
}
