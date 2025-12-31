# API Endpoints Reference (v2)

Documentación exhaustiva y ejemplos completos de cada endpoint del backend de pagos. Incluye solicitudes, respuestas, headers, y flujos de éxito y error.

## Convenciones generales
- Base local: `http://localhost:3000`
- Códigos frecuentes: `200`, `201`, `202`, `400`, `401`, `402`, `404`, `409`, `500`
- Headers comunes: `Content-Type: application/json`, `X-PAYMENT`, `X-PAYMENT-RESPONSE`, `x-internal-api-key`
- Auth: solo `/v1/fiat/set-2fa` exige `x-internal-api-key`; el resto depende de payloads (XDR firmadas o credenciales configuradas en backend)
- Swagger UI: `/docs` (ver configuración en [src/app.config.ts](src/app.config.ts))

## Índice rápido
- [Root](#root)
- [X402 Payments](#x402-payments-api)
- [Fiat Automation](#fiat-automation-v1fiat)
- [Soroban Smart Contracts](#soroban-smart-contracts-apisoroban)
- [Integrated Payments](#integrated-payments-apiintegrated)

---

## Root
**GET /**
- Propósito: health básico Nest; responde `Hello World!`.
- Ejemplo:
  ```http
  GET / HTTP/1.1
  Host: localhost:3000
  ```
- Respuesta `200` (text/plain): `Hello World!`

---

## X402 Payments (`/api`)
Unifica pagos crypto (Stellar XDR) y fiat (QR bancario) en un solo endpoint.

### GET /api/pay — descubrimiento (sin `X-PAYMENT`)
- Query obligatoria: `orderId` (string), `amountUsd` (number)
- Query opcional: `description`, `resource`, `fiatAmount`, `currency`, `symbol`, `requiresManualConfirmation`, `payTo`
- Ejemplo solicitud (descubrimiento):
  ```http
  GET /api/pay?orderId=ORDER-123&amountUsd=25.5&description=Suscripcion&resource=/product/123&fiatAmount=175&currency=BOB&symbol=Bs.&requiresManualConfirmation=true HTTP/1.1
  Host: localhost:3000
  ```
- Respuesta `402 Payment Required` (ofrece opciones):
  ```json
  {
    "x402Version": 1,
    "resource": "Product",
    "accepts": [
      {
        "type": "crypto",
        "scheme": "exact",
        "network": "stellar-testnet",
        "amountRequired": "255000000",
        "resource": "Product",
        "payTo": "GDESTINO...",
        "asset": "native",
        "maxTimeoutSeconds": 300
      },
      {
        "type": "fiat",
        "currency": "BOB",
        "symbol": "Bs.",
        "amountRequired": "175",
        "ipfsQrLink": "https://gateway.pinata.cloud/ipfs/Qm...",
        "maxTimeoutSeconds": 60,
        "resource": "Product"
      }
    ],
    "error": "X-PAYMENT header is required",
    "jobId": "x402_..."
  }
  ```

### GET /api/pay — pago crypto (con `X-PAYMENT`)
- Headers: `X-PAYMENT` = base64(JSON con XDR firmado)
- Ejemplo payload (antes de base64):
  ```json
  {
    "x402Version": 1,
    "type": "crypto",
    "scheme": "exact",
    "network": "stellar-testnet",
    "payload": {
      "signedTxXdr": "AAAAAgAAAAA...",
      "sourceAccount": "GPAYER...",
      "amount": "255000000",
      "destination": "GDESTINO...",
      "asset": "native",
      "validUntilLedger": 123456,
      "nonce": "f5e1d7b3-6d8c-4b5e-8e9a-1f2c3d4e5f6a"
    }
  }
  ```
- Ejemplo solicitud:
  ```http
  GET /api/pay?orderId=ORDER-123&amountUsd=25.5 HTTP/1.1
  Host: localhost:3000
  X-PAYMENT: eyJ4NDAyVmVyc2lvbiI6MSwidHlwZSI6ImNyeXB0byIs...
  ```
- Respuesta `200 OK`:
  ```json
  {
    "success": true,
    "type": "crypto",
    "transaction": "afe1c9...",
    "network": "stellar-testnet",
    "payer": "GPAYER...",
    "errorReason": null
  }
  ```
- Header de salida: `X-PAYMENT-RESPONSE` base64 del mismo JSON.

### GET /api/pay — pago fiat (con `X-PAYMENT`)
- Headers: `X-PAYMENT` = base64(JSON fiat)
- Payload fiat (antes de base64):
  ```json
  {
    "x402Version": 1,
    "type": "fiat",
    "currency": "BOB",
    "payload": {
      "glosa": "BM-QR-INV-1001",
      "time": "2024-06-01T12:00:00Z",
      "transactionId": "TRX123456"
    }
  }
  ```
- Respuesta `200 OK` (verificado):
  ```json
  {
    "success": true,
    "type": "fiat",
    "transaction": "TRX123456",
    "currency": "BOB",
    "errorReason": null
  }
  ```
- Respuesta `402` (no verificado): incluye nuevas opciones y `error` indicando que no se pudo verificar el pago.

### GET /api/health
- Propósito: estado del facilitador X402.
- Respuesta `200`:
  ```json
  {
    "status": "ok",
    "facilitatorReady": true,
    "network": "stellar-testnet",
    "facilitatorAddress": "G..."
  }
  ```

---

## Fiat Automation (`/v1/fiat`)
Automatiza generación y verificación de QR bancario.

### POST /v1/fiat/generate-qr
- Body:
  ```json
  {
    "orderId": "ORDER-123456",
    "amount": 150.75,
    "details": "BM-QR-INV-1001"
  }
  ```
- Respuestas:
  - `202 Accepted`: `{ "status": "accepted", "orderId": "ORDER-123456", "details": "BM-QR-INV-1001" }`
  - `409 Conflict`: QR ya existe para la orden o glosa.

### POST /v1/fiat/verify-payment
- Body:
  ```json
  {
    "orderId": "ORDER-123456",
    "details": "BM-QR-INV-1001"
  }
  ```
- Respuesta `202 Accepted`: `{ "status": "accepted" }`

### POST /v1/fiat/set-2fa
- Headers: `x-internal-api-key: <clave>`
- Body:
  ```json
  { "code": "123456" }
  ```
- Respuestas:
  - `200 OK`: `{ "status": "updated", "message": "Retry the job now" }`
  - `401 Unauthorized`: clave inválida o no configurada.

---

## Soroban Smart Contracts (`/api/soroban`)
Operaciones on-chain sobre PasanakuFactory y PasanakuGroup en Stellar/Soroban.

### GET /api/soroban/health
- Respuesta `200`:
  ```json
  { "status": "ok", "isReady": true, "adminAddress": "G..." }
  ```

### POST /api/soroban/groups
- Body (creación de grupo):
  ```json
  {
    "members": ["GAAA...", "GBBB...", "GCCC..."],
    "amountPerRound": "10000000",
    "frequencyDays": 7,
    "enableYield": true,
    "yieldShareBps": 7000
  }
  ```
- Respuesta `201 Created`:
  ```json
  { "success": true, "groupAddress": "CXYZ...", "txHash": "9f0c..." }
  ```

### POST /api/soroban/groups/:groupAddress/deposit
- Body:
  ```json
  {
    "beneficiary": "GAAA...",
    "amount": "10000000"
  }
  ```
- Respuesta `200`:
  ```json
  { "success": true, "txHash": "abcd..." }
  ```

### POST /api/soroban/groups/:groupAddress/payout
- Body:
  ```json
  { "winner": "GAAA..." }
  ```
- Respuesta `200`:
  ```json
  { "success": true, "txHash": "ef01...", "amount": "70000000" }
  ```

### POST /api/soroban/groups/:groupAddress/sweep-yield
- Body:
  ```json
  { "treasuryAddress": "GTREASURY..." }
  ```
- Respuesta `200`:
  ```json
  { "success": true, "txHash": "12ab...", "amount": "500000" }
  ```

### GET /api/soroban/groups/:groupAddress/config
- Respuesta `200` (ejemplo abreviado):
  ```json
  {
    "token": "CBIELT...", "amount_per_round": "10000000", "frequency_days": 7,
    "yield_enabled": true, "yield_share_bps": 7000, "admin": "G..."
  }
  ```

### GET /api/soroban/groups/:groupAddress/members
- Respuesta `200`:
  ```json
  [
    { "address": "GAAA...", "hasPaid": true, "lastPayment": "2024-06-01T12:00:00Z" },
    { "address": "GBBB...", "hasPaid": false, "lastPayment": null }
  ]
  ```

### GET /api/soroban/groups/:groupAddress/round
- Respuesta `200`: `{ "currentRound": 3 }`

### GET /api/soroban/groups/:groupAddress/estimated-yield
- Respuesta `200`: `{ "estimatedYield": "250000" }`

---

## Integrated Payments (`/api/integrated`)
Orquesta la liquidación X402 con los contratos Soroban.

### POST /api/integrated/payments/:jobId/register
- Body:
  ```json
  {
    "groupAddress": "CXYZ...",
    "memberAddress": "GAAA..."
  }
  ```
- Respuesta `200`:
  ```json
  { "success": true, "txHash": "abcd..." }
  ```
- Errores comunes: job no existe, job no está `settled`, error Soroban (simulación fallida o fondos insuficientes).

### POST /api/integrated/groups/:groupAddress/payout
- Body:
  ```json
  { "winnerAddress": "GAAA..." }
  ```
- Respuesta `200`: `{ "success": true, "txHash": "ef01..." }`
  - Internamente luego intenta `sweep-yield` automático.

### POST /api/integrated/groups/:groupAddress/sweep-yield
- Body:
  ```json
  { "treasuryAddress": "GTREASURY..." }
  ```
- Respuesta `200`: `{ "success": true, "txHash": "12ab..." }`

### GET /api/integrated/groups/:groupAddress/status
- Respuesta `200`:
  ```json
  {
    "config": { ... },
    "members": [ ... ],
    "currentRound": 3,
    "estimatedYield": "250000"
  }
  ```

---

## Flujo recomendado
1) `GET /api/pay` sin `X-PAYMENT` → recibe `402` con opciones crypto/fiat.
2) Cliente firma y reenvía `GET /api/pay` con header `X-PAYMENT` (crypto XDR o payload fiat) → `200` + header `X-PAYMENT-RESPONSE`.
3) Registrar en contrato: `POST /api/integrated/payments/:jobId/register`.
4) Cerrar ronda: `POST /api/integrated/groups/:groupAddress/payout` (y auto `sweep-yield`).
5) Opcional: `GET /api/integrated/groups/:groupAddress/status` para panel.

## Errores habituales
- `402 Payment Required`: falta `X-PAYMENT` o verificación/settlement falló.
- `401 Unauthorized`: `x-internal-api-key` inválida en `/v1/fiat/set-2fa`.
- `409 Conflict`: QR ya generado o en proceso.
- `400/500 Soroban`: simulación fallida, fondos insuficientes o servicio no configurado.
