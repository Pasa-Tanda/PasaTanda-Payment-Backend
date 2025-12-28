import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FiatModule } from './fiat/fiat.module';
import { X402Module } from './x402/x402.module';
import { SorobanModule } from './soroban/soroban.module';
import { IntegratedPaymentModule } from './integrated-payment/integrated-payment.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    FiatModule,
    X402Module,
    SorobanModule,
    IntegratedPaymentModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
