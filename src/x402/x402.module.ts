import { Module, forwardRef } from '@nestjs/common';
import { X402Controller } from './x402.controller';
import {
  X402PaymentService,
  X402FacilitatorService,
  X402WebhookService,
  X402JobQueueService,
} from './services';
import { FiatModule } from '../fiat/fiat.module';

/**
 * X402 Payment Module
 *
 * Implements the x402 payment protocol for cryptocurrency payments
 * on Stellar Network (testnet).
 *
 * Features:
 * - HTTP 402 Payment Required flow
 * - XDR-based signed transactions for native XLM and USDC transfers
 * - Manual confirmation workflow for agent verification
 * - Webhook notifications for payment events
 * - Sequential job queue for blockchain transactions
 * - Optional fee sponsorship for gasless payments
 */
@Module({
  imports: [forwardRef(() => FiatModule)],
  controllers: [X402Controller],
  providers: [
    X402PaymentService,
    X402FacilitatorService,
    X402WebhookService,
    X402JobQueueService,
  ],
  exports: [X402PaymentService, X402FacilitatorService],
})
export class X402Module {}
