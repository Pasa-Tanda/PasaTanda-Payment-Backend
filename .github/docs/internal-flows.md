# Procesos internos del backend de pagos

Guía paso a paso de lo que ocurre dentro del backend para cada flujo principal: descubrimiento y liquidación X402 (crypto/fiat), automatización bancaria, interacción Soroban y orquestación integrada.

## 1) Flujo X402 Crypto (GET /api/pay con X-PAYMENT crypto)
1. `X402Controller.pay` crea un job con `createPaymentJob` en `X402PaymentService` y guarda `PaymentRequirements` (monto en stroops, destino `payTo`, timeout, asset).
2. Si llega `X-PAYMENT`, el controlador decodifica y pasa a `processPayment(jobId, xPaymentHeader)`.
3. `processPayment` valida expiración/estado y marca `paymentMethod=crypto`; encola `verifyAndSettle` en `X402JobQueueService` para ejecución secuencial.
4. `verifyAndSettle` usa `X402FacilitatorService.verify` para validar:
   - versión x402, red y esquema `exact`;
   - firma XDR contra el `sourceAccount`;
   - operación `payment` al `payTo` esperado, asset correcto y monto ≥ requerido;
   - balance suficiente en Horizon.
5. Si es válido, se envía webhook `X402_PAYMENT_VERIFIED` y se pasa a `settle` (submit Stellar tx, con fee-bump opcional del facilitador si `feeSponsorship=true`).
6. Si `settle` devuelve éxito, se marca `settled`; si `requiresManualConfirmation=false`, se marca `completed` y se envía webhook `X402_PAYMENT_CONFIRMED`. Caso contrario queda en `settled` esperando confirmación manual.
7. El controlador construye `SettlementResponse`, lo codifica en `X-PAYMENT-RESPONSE` y responde 200. Si falla, responde 402 con nuevas opciones.

## 2) Flujo X402 Fiat (GET /api/pay con X-PAYMENT fiat)
1. `X402Controller.pay` crea/recupera job; cuando `X-PAYMENT` es fiat, invoca `handleFiatPayment`.
2. Se valida que el job no esté bloqueado a crypto. La glosa se toma de `payload.glosa` o `dto.description`.
3. `FiatAutomationService.verifyPaymentInline` encola verificación bancaria en `JobQueueService` con timeout (30s por defecto); si la glosa aparece como pagada, retorna `true`.
4. Si se verifica, el job se marca `completed` (método fiat) y se responde 200 con `SettlementResponse` + header `X-PAYMENT-RESPONSE`.
5. Si no se verifica, se bloquea el método a fiat, se guarda el error y se responde 402 con nuevas opciones (crypto o reintento de fiat).

## 3) Flujo de descubrimiento de opciones (GET /api/pay sin X-PAYMENT)
1. `X402Controller.pay` llama `buildAccepts`:
   - Siempre ofrece crypto (`buildCryptoAccept`).
   - Si no está bloqueado a crypto, intenta fiat: `generateQrWithTimeout` (30s) en `FiatAutomationService` genera QR vía `FiatBrowserService` y lo procesa con `QrImageProcessingService` (recorte, invert, resize, logo, template HTML, upload IPFS).
   - Si IPFS falla, usa `getDefaultQrLink`.
2. Responde 402 con `accepts`, `jobId`, `resource` y `x402Version`.

## 4) Automatización bancaria (servicios Fiat)
- `FiatController.generateQr` → `FiatService.queueGenerateQr` → `JobQueueService.enqueueQrJob` → `FiatAutomationService.processGenerateQr` → `FiatBrowserService.generateQr` → webhook `sendQrGenerated`.
- `FiatController.verifyPayment` → `FiatService.queueVerifyPayment` → `FiatAutomationService.processVerifyPayment` → `FiatBrowserService.verifyPayment` → webhook `sendVerificationResult`.
- Errores de 2FA (`TwoFactorRequiredError`) disparan webhook `sendTwoFactorRequired`. El 2FA se actualiza vía `/v1/fiat/set-2fa` que persiste en `TwoFaStoreService`.

## 5) Contratos Soroban
- `SorobanService` inicializa RPC y admin (`SOROBAN_ADMIN_SECRET_KEY`). Si falta config, `isReady=false`.
- `createGroup`: llama a `PasanakuFactory.create_group` con miembros, monto (i128), frecuencia, enableYield, yieldShareBps y dirección del Blend Pool. Simula, arma tx, firma admin, envía y espera resultado para extraer `groupAddress`.
- `depositFor`: `PasanakuGroup.deposit_for(admin, beneficiary, amount)`; simula, arma y firma admin, envía y retorna `txHash`.
- `payout`: `PasanakuGroup.payout(winner)`; flujo igual.
- `sweepYield`: `PasanakuGroup.admin_sweep_yield(treasury)`; retorna `amount` si aplica.
- Consultas (`getGroupConfig`, `getMembers`, `getCurrentRound`, `getEstimatedYield`) usan `call` y adaptan SCVals a objetos JS.

## 6) Orquestación integrada
- `IntegratedPaymentService.registerPaymentOnChain(jobId, group, member)`:
  - Obtiene job X402; valida que esté `settled` o `completed`.
  - Convierte `amountUsd` a stroops (1 USDC = 10,000,000 stroops) y llama `sorobanService.depositFor`.
- `executeRoundPayout`: llama `sorobanService.payout` y luego `sweepPlatformYield` automático.
- `sweepPlatformYield`: llama `sorobanService.sweepYield` con `treasuryAddress` opcional.
- `getGroupStatus`: reúne `config`, `members`, `currentRound`, `estimatedYield` en paralelo.
- Método utilitario `processAndRegisterPayment` (no expuesto por controller) ejecuta `processPayment` X402 y luego `registerPaymentOnChain` en una sola llamada.

## 7) Consideraciones de configuración
- X402: `X402_FACILITATOR_PRIVATE_KEY`, `X402_PAY_TO_ADDRESS`, `X402_PAYMENT_TIMEOUT_SECONDS`, `X402_DEFAULT_RESOURCE`.
- Fiat: `INTERNAL_API_KEY`, credenciales/navegador bancario usados por `FiatBrowserService`, `IPFS_API_KEY/SECRET/GROUP_ID`, `DEFAULT_QR_IPFS_LINK`.
- Soroban: `SOROBAN_RPC_URL`, `SOROBAN_ADMIN_SECRET_KEY`, `BLEND_POOL_ADDRESS` (opcional).
- CORS y headers permitidos se definen en `configureApp`.
