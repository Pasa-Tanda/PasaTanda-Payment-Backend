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
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SorobanService } from './soroban.service';
import { CreateGroupDto, DepositForDto, PayoutDto, SweepYieldDto } from './dto';

/**
 * Soroban Controller
 * 
 * REST API for interacting with PasaTanda smart contracts
 */
@ApiTags('Soroban Smart Contracts')
@Controller('api/soroban')
export class SorobanController {
  private readonly logger = new Logger(SorobanController.name);

  constructor(private readonly sorobanService: SorobanService) {}

  @Get('health')
  @ApiOperation({
    summary: 'Check Soroban service health',
    description: 'Verify connection to Stellar Testnet and admin configuration',
  })
  @ApiResponse({
    status: 200,
    description: 'Health status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        isReady: { type: 'boolean' },
        adminAddress: { type: 'string' },
      },
    },
  })
  getHealth(): {
    status: string;
    isReady: boolean;
    adminAddress?: string;
  } {
    return {
      status: this.sorobanService.isReady() ? 'ok' : 'not_configured',
      isReady: this.sorobanService.isReady(),
      adminAddress: this.sorobanService.getAdminAddress(),
    };
  }

  @Post('groups')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new PasanakuGroup',
    description: 'Deploy a new pasanaku group contract via PasanakuFactory',
  })
  @ApiResponse({
    status: 201,
    description: 'Group created successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        groupAddress: { type: 'string' },
        txHash: { type: 'string' },
      },
    },
  })
  async createGroup(@Body() dto: CreateGroupDto) {
    return await this.sorobanService.createGroup(
      dto.members,
      dto.amountPerRound,
      dto.frequencyDays,
      dto.enableYield ?? true,
      dto.yieldShareBps ?? 7000,
    );
  }

  @Post('groups/:groupAddress/deposit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register a member payment (deposit_for)',
    description: 'Admin deposits USDC on behalf of a member',
  })
  @ApiParam({
    name: 'groupAddress',
    description: 'PasanakuGroup contract address',
  })
  @ApiResponse({
    status: 200,
    description: 'Deposit successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        txHash: { type: 'string' },
      },
    },
  })
  async depositFor(
    @Param('groupAddress') groupAddress: string,
    @Body() dto: DepositForDto,
  ) {
    return await this.sorobanService.depositFor(
      groupAddress,
      dto.beneficiary,
      dto.amount,
    );
  }

  @Post('groups/:groupAddress/payout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Execute payout to round winner',
    description: 'Admin triggers payout of accumulated funds to the winner',
  })
  @ApiParam({
    name: 'groupAddress',
    description: 'PasanakuGroup contract address',
  })
  @ApiResponse({
    status: 200,
    description: 'Payout successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        txHash: { type: 'string' },
        amount: { type: 'string' },
      },
    },
  })
  async payout(
    @Param('groupAddress') groupAddress: string,
    @Body() dto: PayoutDto,
  ) {
    return await this.sorobanService.payout(groupAddress, dto.winner);
  }

  @Post('groups/:groupAddress/sweep-yield')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sweep platform yield earnings',
    description: 'Admin withdraws platform share of Blend yield to treasury',
  })
  @ApiParam({
    name: 'groupAddress',
    description: 'PasanakuGroup contract address',
  })
  @ApiResponse({
    status: 200,
    description: 'Yield swept successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        txHash: { type: 'string' },
        amount: { type: 'string' },
      },
    },
  })
  async sweepYield(
    @Param('groupAddress') groupAddress: string,
    @Body() dto: SweepYieldDto,
  ) {
    return await this.sorobanService.sweepYield(
      groupAddress,
      dto.treasuryAddress,
    );
  }

  @Get('groups/:groupAddress/config')
  @ApiOperation({
    summary: 'Get group configuration',
    description: 'Query group settings (token, amount, frequency, etc.)',
  })
  @ApiParam({
    name: 'groupAddress',
    description: 'PasanakuGroup contract address',
  })
  async getGroupConfig(@Param('groupAddress') groupAddress: string) {
    return await this.sorobanService.getGroupConfig(groupAddress);
  }

  @Get('groups/:groupAddress/members')
  @ApiOperation({
    summary: 'Get members status',
    description: 'Query all members and their payment status for current round',
  })
  @ApiParam({
    name: 'groupAddress',
    description: 'PasanakuGroup contract address',
  })
  async getMembers(@Param('groupAddress') groupAddress: string) {
    return await this.sorobanService.getMembers(groupAddress);
  }

  @Get('groups/:groupAddress/round')
  @ApiOperation({
    summary: 'Get current round number',
    description: 'Query the current round/cycle number',
  })
  @ApiParam({
    name: 'groupAddress',
    description: 'PasanakuGroup contract address',
  })
  async getCurrentRound(@Param('groupAddress') groupAddress: string) {
    return {
      currentRound: await this.sorobanService.getCurrentRound(groupAddress),
    };
  }

  @Get('groups/:groupAddress/estimated-yield')
  @ApiOperation({
    summary: 'Get estimated yield',
    description: 'Query estimated yield from Blend pool',
  })
  @ApiParam({
    name: 'groupAddress',
    description: 'PasanakuGroup contract address',
  })
  async getEstimatedYield(@Param('groupAddress') groupAddress: string) {
    return {
      estimatedYield: await this.sorobanService.getEstimatedYield(groupAddress),
    };
  }
}
