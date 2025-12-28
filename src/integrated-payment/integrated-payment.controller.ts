import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { IntegratedPaymentService } from './integrated-payment.service';
import {
  RegisterPaymentDto,
  ExecutePayoutDto,
  SweepYieldDto,
} from './dto';

/**
 * Integrated Payment Controller
 * 
 * Endpoints for the complete PasaTanda payment flow
 */
@ApiTags('Integrated Payments')
@Controller('api/integrated')
export class IntegratedPaymentController {
  private readonly logger = new Logger(IntegratedPaymentController.name);

  constructor(
    private readonly integratedService: IntegratedPaymentService,
  ) {}

  @Post('payments/:jobId/register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register verified payment on smart contract',
    description:
      'After X402 payment is verified and settled, register it on PasanakuGroup contract. ' +
      'Funds will auto-invest in Blend Pool.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'X402 payment job ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment registered on-chain',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        txHash: { type: 'string' },
      },
    },
  })
  async registerPayment(
    @Param('jobId') jobId: string,
    @Body() dto: RegisterPaymentDto,
  ) {
    return await this.integratedService.registerPaymentOnChain(
      jobId,
      dto.groupAddress,
      dto.memberAddress,
    );
  }

  @Post('groups/:groupAddress/payout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Execute round payout and sweep yield',
    description:
      'Payout accumulated funds to round winner. ' +
      'Automatically sweeps platform yield after payout.',
  })
  @ApiParam({
    name: 'groupAddress',
    description: 'PasanakuGroup contract address',
  })
  @ApiResponse({
    status: 200,
    description: 'Payout executed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        txHash: { type: 'string' },
      },
    },
  })
  async executePayout(
    @Param('groupAddress') groupAddress: string,
    @Body() dto: ExecutePayoutDto,
  ) {
    return await this.integratedService.executeRoundPayout(
      groupAddress,
      dto.winnerAddress,
    );
  }

  @Post('groups/:groupAddress/sweep-yield')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually sweep platform yield',
    description: 'Withdraw platform share of Blend yield to treasury',
  })
  @ApiParam({
    name: 'groupAddress',
    description: 'PasanakuGroup contract address',
  })
  @ApiResponse({
    status: 200,
    description: 'Yield swept successfully',
  })
  async sweepYield(
    @Param('groupAddress') groupAddress: string,
    @Body() dto: SweepYieldDto,
  ) {
    return await this.integratedService.sweepPlatformYield(
      groupAddress,
      dto.treasuryAddress,
    );
  }

  @Get('groups/:groupAddress/status')
  @ApiOperation({
    summary: 'Get complete group status',
    description:
      'Get group configuration, members, current round, and estimated yield',
  })
  @ApiParam({
    name: 'groupAddress',
    description: 'PasanakuGroup contract address',
  })
  @ApiResponse({
    status: 200,
    description: 'Group status retrieved',
  })
  async getGroupStatus(@Param('groupAddress') groupAddress: string) {
    return await this.integratedService.getGroupStatus(groupAddress);
  }
}
