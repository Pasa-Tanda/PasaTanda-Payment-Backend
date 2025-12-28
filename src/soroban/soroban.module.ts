import { Module } from '@nestjs/common';
import { SorobanService } from './soroban.service';
import { SorobanController } from './soroban.controller';

/**
 * Soroban Module
 * 
 * Provides integration with PasaTanda smart contracts on Stellar Soroban:
 * - PasanakuFactory: Create new pasanaku groups
 * - PasanakuGroup: Manage deposits, payouts, and yield
 */
@Module({
  providers: [SorobanService],
  controllers: [SorobanController],
  exports: [SorobanService],
})
export class SorobanModule {}
