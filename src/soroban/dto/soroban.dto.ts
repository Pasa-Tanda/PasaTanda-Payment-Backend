import { IsArray, IsString, IsNumber, IsOptional, IsPositive, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating a new PasanakuGroup
 */
export class CreateGroupDto {
  @ApiProperty({
    description: 'Array of member Stellar addresses (G...)',
    example: ['GXXXXX...', 'GYYYYYY...', 'GZZZZZ...'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  members!: string[];

  @ApiProperty({
    description: 'Amount per round in stroops (7 decimals, e.g., 10000000 = 1 USDC)',
    example: '10000000',
  })
  @IsString()
  amountPerRound!: string;

  @ApiProperty({
    description: 'Payment frequency in days',
    example: 7,
  })
  @IsNumber()
  @IsPositive()
  frequencyDays!: number;

  @ApiPropertyOptional({
    description: 'Enable Blend yield generation',
    example: true,
    default: true,
  })
  @IsOptional()
  enableYield?: boolean;

  @ApiPropertyOptional({
    description: 'Yield share for users in basis points (7000 = 70%)',
    example: 7000,
    default: 7000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  yieldShareBps?: number;
}

/**
 * DTO for deposit_for operation
 */
export class DepositForDto {
  @ApiProperty({
    description: 'Member Stellar address making the payment',
    example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsString()
  beneficiary!: string;

  @ApiProperty({
    description: 'Amount in stroops (7 decimals)',
    example: '10000000',
  })
  @IsString()
  amount!: string;
}

/**
 * DTO for payout operation
 */
export class PayoutDto {
  @ApiProperty({
    description: 'Winner Stellar address',
    example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsString()
  winner!: string;
}

/**
 * DTO for sweep_yield operation
 */
export class SweepYieldDto {
  @ApiPropertyOptional({
    description: 'Treasury Stellar address (defaults to admin address)',
    example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsOptional()
  @IsString()
  treasuryAddress?: string;
}
