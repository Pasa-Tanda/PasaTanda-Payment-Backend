import { Module } from '@nestjs/common';
import { IntegratedPaymentService } from './integrated-payment.service';
import { IntegratedPaymentController } from './integrated-payment.controller';
import { X402Module } from '../x402/x402.module';
import { SorobanModule } from '../soroban/soroban.module';

/**
 * Integrated Payment Module
 * 
 * Combines X402 payment protocol with Soroban smart contracts
 * to provide a complete payment solution for PasaTanda
 */
@Module({
  imports: [X402Module, SorobanModule],
  providers: [IntegratedPaymentService],
  controllers: [IntegratedPaymentController],
  exports: [IntegratedPaymentService],
})
export class IntegratedPaymentModule {}
