import { IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for registering payment on-chain
 */
export class RegisterPaymentDto {
  @ApiProperty({
    description: 'PasanakuGroup contract address',
    example: 'CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsString()
  groupAddress!: string;

  @ApiProperty({
    description: 'Member Stellar address',
    example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsString()
  memberAddress!: string;
}

/**
 * DTO for executing payout
 */
export class ExecutePayoutDto {
  @ApiProperty({
    description: 'Winner Stellar address',
    example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsString()
  winnerAddress!: string;
}

/**
 * DTO for sweeping yield
 */
export class SweepYieldDto {
  @ApiPropertyOptional({
    description: 'Treasury Stellar address (defaults to admin)',
    example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsString()
  treasuryAddress?: string;
}
