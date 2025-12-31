# PasaTanda Payment Backend - Integración Soroban + X402

## 📋 Descripción

Backend de pagos para PasaTanda que integra:
- **X402 Payment Protocol**: Protocolo HTTP 402 para pagos en Stellar
- **Soroban Smart Contracts**: Contratos inteligentes desplegados en Stellar Testnet
- **Fiat QR Payments**: Pagos bancarios tradicionales via QR
- **Blend Protocol**: Generación automática de rendimiento

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│  Usuario (WhatsApp/Web)                                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Payment Backend (NestJS)                                        │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ X402 Module  │  │ Soroban      │  │ Integrated   │          │
│  │              │  │ Module       │  │ Payment      │          │
│  │ - Facilitator│  │              │  │ Module       │          │
│  │ - Payment    │  │ - deposit_for│  │              │          │
│  │ - Webhook    │  │ - payout     │  │ - Orquestador│          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                   │
│  ┌──────────────┐                                                │
│  │ Fiat Module  │                                                │
│  │              │                                                │
│  │ - QR Gen     │                                                │
│  │ - Verify     │                                                │
│  └──────────────┘                                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stellar Testnet (Soroban)                                       │
│                                                                   │
│  ┌──────────────────┐         ┌──────────────────┐              │
│  │ PasanakuFactory  │────────▶│ PasanakuGroup    │              │
│  │ CCYLAWPJ...      │  create │ (Contract)       │              │
│  └──────────────────┘         └────────┬─────────┘              │
│                                         │                         │
│                                         │ auto-invest             │
│                                         ▼                         │
│                               ┌──────────────────┐               │
│                               │ Blend Pool       │               │
│                               │ (Yield Gen)      │               │
│                               └──────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Flujo de Pago Completo

Según [PasaTanda_payment_flow.md](/.github/docs/PasaTanda_payment_flow.md):

### FASE 1: Generación de Cobro
```
Agent Backend → Payment Backend: GET /api/pay
                ↓
Payment Backend: Genera QR Simple + Challenge X402
                ↓
                ← 402 Payment Required
                  Header: WWW-Authenticate: x402 <Challenge_XDR>
                  Body: { qr_url: "ipfs://..." }
```

### FASE 2: Intención de Pago (Cliente)
```
Usuario → Frontend: Abre /pagos/{uuid}
          ↓
Frontend → Agent Backend: GET /orders/{uuid}
          ↓
Usuario selecciona método:
  ├─ QR Fiat → Sube comprobante
  └─ Crypto Wallet → Firma transacción XDR
```

### FASE 3: Verificación Unificada (GET /api/pay)
```
CAMINO A: Fiat
Agent Backend → Payment Backend: GET /api/pay + proof_metadata
                ↓
Payment Backend: Consulta banco
                ↓
Banco confirma → On-Ramp (HotWallet → Contract)
                ↓
                deposit_for(Backend, User, Amount)
                ↓
Stellar: Registra pago en PasanakuGroup
                ↓
Blend: Auto-inversión
                ↓
                ← 200 OK { tx_hash: "..." }

CAMINO B: Crypto
Agent Backend → Payment Backend: GET /api/pay + X-PAYMENT header
                ↓
Payment Backend: Valida firmas
                ↓
Stellar: Submit Transaction (XDR firmado por user)
                ↓
                deposit_for(User, User, Amount)
                ↓
Blend: Auto-inversión
                ↓
                ← 200 OK + X-PAYMENT-RESPONSE
```

### FASE 4: Payout (Retiro)
```
Agent Backend detecta ganador
       ↓
POST /api/integrated/groups/{groupAddress}/payout
       ↓
Soroban: payout(winner)
       ↓
Blend: Retira fondos + intereses
       ↓
Stellar: Transfiere USDC a ganador
       ↓
Payment Backend: admin_sweep_yield (automático)
       ↓
Stellar: Transfiere ganancia de plataforma a treasury
```

## 📦 Instalación

```bash
npm install
```

## ⚙️ Configuración

Copia el archivo de ejemplo:
```bash
cp .env.example .env
```

### Variables Críticas

```env
# STELLAR SOROBAN (bmstellar account)
SOROBAN_ADMIN_SECRET_KEY=SXXXXX...  # Secret key del admin
X402_FACILITATOR_PRIVATE_KEY=SXXXXX...  # Mismo que SOROBAN_ADMIN_SECRET_KEY
X402_PAY_TO_ADDRESS=GXXXXX...  # Public key del admin

# CONTRATOS DESPLEGADOS
PASANAKU_FACTORY_ADDRESS=CCYLAWPJM6OVZ222HLPZBE5VLP5HYS43575LI4SCYMGC35JFL2DQUSGD
USDC_CONTRACT_ADDRESS=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

# BLEND POOL (Obtener de https://testnet.blend.capital)
BLEND_POOL_ADDRESS=CXXXXX...  # Dirección del pool

# FX (Binance P2P opcional)
BINANCE_P2P_API_KEY=xxxx
BINANCE_P2P_API_SECRET=xxxx
BINANCE_P2P_SYMBOL=USDTBOB  # Par de referencia para FX (USDT→BOB)
BINANCE_P2P_FALLBACK_RATE=9.82  # Se usa si el API no responde
```

### Obtener Blend Pool Address

1. Visita https://testnet.blend.capital
2. Busca un pool activo de USDC
3. Copia la dirección del contrato
4. Configura `BLEND_POOL_ADDRESS` en `.env`

## 🔑 Configuración de Cuentas

### 1. Cuenta Admin (bmstellar)

Esta cuenta debe:
- Tener fondos XLM para pagar fees (~100 XLM recomendado)
- Ser el admin de los contratos PasanakuGroup
- Tener la misma clave en `SOROBAN_ADMIN_SECRET_KEY` y `X402_FACILITATOR_PRIVATE_KEY`

**Obtener fondos de prueba:**
```bash
curl "https://friendbot.stellar.org?addr=GXXXXX..."
```

### 2. Crear Grupo de Prueba

```bash
# Usando el endpoint
POST /api/soroban/groups
{
  "members": [
    "GABC...",
    "GDEF...",
    "GHIJ..."
  ],
  "amountPerRound": "10000000",  // 1 USDC en stroops
  "frequencyDays": 7,
  "enableYield": true,
  "yieldShareBps": 7000  // 70% para usuarios, 30% plataforma
}
```

## 🧪 Testing

### 1. Health Checks

```bash
# Soroban service
GET /api/soroban/health

# X402 facilitator
GET /api/health
```

### 2. Test Flow Completo

```bash
# 1. Crear grupo
POST /api/soroban/groups
{
  "members": ["GABC...", "GDEF..."],
  "amountPerRound": "10000000",
  "frequencyDays": 7
}
# Response: { "groupAddress": "CXXXXX..." }

# 2. Generar payment request (402)
GET /api/pay?orderId=TEST-001&amountUsd=1&payTo=GXXXXX...
# Response: 402 + Challenge XDR

# 3. Usuario firma y envía pago
GET /api/pay?orderId=TEST-001&... + X-PAYMENT header
# Response: 200 OK

# 4. Registrar en contrato (automático o manual)
POST /api/integrated/payments/{jobId}/register
{
  "groupAddress": "CXXXXX...",
  "memberAddress": "GABC..."
}
# Response: { "success": true, "txHash": "..." }

# 5. Verificar estado del grupo
GET /api/integrated/groups/CXXXXX.../status
# Response: { config, members, currentRound, estimatedYield }

# 6. Ejecutar payout (fin de ronda)
POST /api/integrated/groups/CXXXXX.../payout
{
  "winnerAddress": "GABC..."
}
# Response: { "success": true, "txHash": "..." }
```

## 📚 Endpoints Principales

### X402 Payment Protocol

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/pay` | GET | Payment Required (402) + Challenge |
| `/api/pay` + X-PAYMENT | GET | Verify & Settle Payment |
| `/api/health` | GET | X402 Facilitator Health |

### Soroban Smart Contracts

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/soroban/groups` | POST | Crear nuevo PasanakuGroup |
| `/api/soroban/groups/:address/deposit` | POST | Depositar para miembro |
| `/api/soroban/groups/:address/payout` | POST | Ejecutar payout |
| `/api/soroban/groups/:address/sweep-yield` | POST | Retirar ganancia plataforma |
| `/api/soroban/groups/:address/config` | GET | Consultar configuración |
| `/api/soroban/groups/:address/members` | GET | Consultar miembros |
| `/api/soroban/groups/:address/round` | GET | Consultar ronda actual |

### Integrated Payment Flow

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/integrated/payments/:jobId/register` | POST | Registrar pago en contrato |
| `/api/integrated/groups/:address/payout` | POST | Payout + Auto Sweep |
| `/api/integrated/groups/:address/sweep-yield` | POST | Sweep manual |
| `/api/integrated/groups/:address/status` | GET | Estado completo del grupo |

### Fiat QR Payments

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/v1/fiat/generate-qr` | POST | Generar QR bancario |
| `/v1/fiat/verify-payment` | POST | Verificar pago bancario |
| `/v1/fiat/set-2fa` | POST | Configurar 2FA |

## 🔧 Development

```bash
# Desarrollo
npm run start:dev

# Build
npm run build

# Producción
npm run start:prod

# Tests
npm run test
```

## 📖 Documentación API

Swagger UI disponible en:
```
http://localhost:3000/docs
```

## ❓ Preguntas Frecuentes

### ¿Es necesario correr una instancia local del facilitador X402?

**NO.** El backend YA incluye el facilitador integrado en `X402FacilitatorService`. No necesitas correr un servidor separado. El facilitador está embebido en tu aplicación NestJS.

### ¿Cómo funciona el facilitador integrado?

1. **Verify**: Valida firmas XDR y balances
2. **Settle**: Envía transacciones a Stellar
3. **Fee-bumping**: Opcional, el facilitador paga los fees

Todo esto se ejecuta dentro del mismo proceso de NestJS.

### ¿Qué hace el flujo `deposit_for`?

1. Backend recibe pago (fiat o crypto)
2. Backend firma transacción como admin
3. Invoca `deposit_for(from=Admin, beneficiary=User, amount)`
4. Contrato registra pago del usuario
5. **Auto-inversión**: Contrato automáticamente deposita en Blend Pool
6. Fondos generan rendimiento pasivamente

### ¿Cuándo se ejecuta el payout?

1. Agent Backend detecta fin de ronda
2. Llama a `/api/integrated/groups/:address/payout`
3. Contrato retira fondos de Blend (principal + rendimiento)
4. Calcula ganancia del usuario (70%) y plataforma (30%)
5. Transfiere payout al ganador
6. **Automático**: Sweep de ganancia de plataforma

## 🔒 Seguridad

### Consideraciones Importantes

1. **Claves Privadas**: Nunca commitear `.env` con claves reales
2. **Admin Account**: Proteger con HSM en producción
3. **Multisig**: Considerar para operaciones críticas
4. **Rate Limiting**: Implementar en producción
5. **Webhooks**: Validar firmas de webhooks entrantes

### Testnet vs Mainnet

**Testnet** (actual):
- Network: `Test SDF Network ; September 2015`
- RPC: `https://soroban-testnet.stellar.org`
- Explorador: `https://stellar.expert/explorer/testnet`

**Mainnet** (producción):
- Network: `Public Global Stellar Network ; September 2015`
- RPC: `https://soroban-mainnet.stellar.org`
- Explorador: `https://stellar.expert/explorer/public`

## 📞 Soporte

- Documentación Stellar: https://developers.stellar.org
- Documentación Blend: https://docs.blend.capital
- Documentación X402: https://www.x402stellar.xyz/docs
- Smart Contracts: Ver [DOCUMENTATION.md](../pasatanda-soroban-contracts/DOCUMENTATION.md)

## 📝 Licencia

UNLICENSED - Uso privado

---

**Última actualización**: 27 de diciembre de 2025  
**Versión**: 1.0.0  
**Contratos Desplegados**: Ver [DEPLOYED_CONTRACTS.md](../pasatanda-soroban-contracts/DEPLOYED_CONTRACTS.md)
