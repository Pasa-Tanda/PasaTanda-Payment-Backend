/**
 * X402 Protocol Types
 * Based on the x402 payment protocol specification (https://github.com/coinbase/x402)
 *
 * Network: Stellar Testnet
 * Asset: Native XLM and USDC via Stellar Asset Contracts (SAC)
 */

// ============== Network Configuration ==============

export const X402_CONFIG = {
  // Stellar Testnet Configuration
  network: 'stellar-testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  
  // Native XLM Configuration
  nativeAsset: 'native',
  nativeAssetDecimals: 7, // stroops
  
  // USDC on Stellar Testnet (via Stellar Asset Contract)
  usdc: {
    asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
    name: 'USD Coin',
    decimals: 7, // Stellar standard
  },
  
  // x402 Protocol Version
  x402Version: 1,
  scheme: 'exact' as const,
  // Default timeout for payments (5 minutes)
  maxTimeoutSeconds: 300,
  // Block explorer
  blockExplorer: 'https://stellar.expert/explorer/testnet',
} as const;

// ============== Payment Requirements ==============

/**
 * PaymentRequirements - Specifies what payment is required for a resource
 * Returned in HTTP 402 response body
 */
export type PaymentMethodType = 'crypto' | 'fiat';

export interface PaymentRequirements {
  /** Scheme of the payment protocol (e.g., 'exact') */
  scheme: string;
  /** Network identifier (e.g., 'stellar-testnet') */
  network: string;
  /** Maximum amount required in stroops (7 decimals for XLM/USDC) */
  maxAmountRequired: string;
  /** URL of the resource being paid for */
  resource: string;
  /** Human-readable description */
  description: string;
  /** MIME type of the response */
  mimeType: string;
  /** Stellar address to receive the payment (G...) */
  payTo: string;
  /** Maximum time in seconds for the server to respond */
  maxTimeoutSeconds: number;
  /** Asset identifier: 'native' for XLM or contract address for USDC */
  asset: string;
  /** Additional schema information */
  outputSchema?: Record<string, unknown> | null;
  /** Extra Stellar-specific information */
  extra?: {
    feeSponsorship?: boolean;
  } | null;
  /** Payment method category */
  type?: PaymentMethodType;
}

// ============== Payment Options for 402 Responses ==============

export interface CryptoAcceptOption {
  type: 'crypto';
  scheme: string;
  network: string;
  amountRequired: string;
  AmountRequired?: string;
  resource: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  baseCurrency?: string;
}

export interface FiatAcceptOption {
  type: 'fiat';
  currency: string;
  symbol: string;
  amountRequired: string;
  AmountRequired?: string;
  ipfsQrLink?: string;
  IpfsQrLink?: string;
  maxTimeoutSeconds: number;
  resource?: string;
}

export type UnifiedAcceptOption = CryptoAcceptOption | FiatAcceptOption;

export interface UnifiedPaymentRequiredResponse {
  x402Version: number;
  resource: string;
  accepts: UnifiedAcceptOption[];
  error: string;
  jobId?: string;
}

// ============== Payment Payload ==============

/**
 * Stellar XDR-based payment payload
 * Contains the complete signed transaction ready for submission
 */
export interface ExactStellarPayload {
  /** Base64-encoded signed transaction XDR */
  signedTxXdr: string;
  /** Source account (payer) - Stellar address (G...) */
  sourceAccount: string;
  /** Amount in stroops */
  amount: string;
  /** Destination address */
  destination: string;
  /** Asset identifier ('native' or contract address) */
  asset: string;
  /** Valid until ledger sequence number */
  validUntilLedger: number;
  /** Nonce for idempotency */
  nonce: string;
}

/**
 * PaymentPayload - Sent in X-PAYMENT header (base64 encoded JSON)
 */
export interface CryptoPaymentPayload {
  /** x402 protocol version */
  x402Version: number;
  /** Payment method */
  type?: 'crypto';
  /** Payment scheme (e.g., 'exact') */
  scheme: string;
  /** Network identifier (stellar-testnet) */
  network: string;
  /** Scheme-specific payload */
  payload: ExactStellarPayload;
}

export interface FiatPaymentPayload {
  /** x402 protocol version */
  x402Version: number;
  /** Payment method */
  type: 'fiat';
  /** Currency identifier (e.g., BOB) */
  currency: string;
  /** Scheme-specific payload */
  payload: {
    glosa: string;
    time?: string;
    transactionId?: string;
  };
}

export type PaymentPayload = CryptoPaymentPayload | FiatPaymentPayload;

// ============== Verification ==============

/**
 * Response from payment verification
 */
export interface VerifyResponse {
  /** Whether the payment is valid */
  isValid: boolean;
  /** Reason if payment is invalid */
  invalidReason?: string | null;
  /** Address of the payer */
  payer?: string;
}

// ============== Settlement ==============

/**
 * Response from payment settlement
 */
export interface SettleResponse {
  /** Whether the settlement succeeded */
  success: boolean;
  /** Error reason if failed */
  errorReason?: string | null;
  /** Transaction hash on blockchain */
  transaction: string;
  /** Network where settlement occurred */
  network: string;
  /** Address of the payer */
  payer?: string;
}

/**
 * Settlement response header (X-PAYMENT-RESPONSE)
 */
export interface SettlementResponse {
  /** Whether settlement was successful */
  success: boolean;
  /** Payment method */
  type: PaymentMethodType;
  /** Transaction hash or bank reference */
  transaction: string | null;
  /** Network ID */
  network?: string;
  /** Payer address (Stellar G... address) */
  payer?: string;
  /** Currency for fiat settlements */
  currency?: string;
  /** Error reason if settlement failed */
  errorReason: string | null;
}

// ============== HTTP 402 Response ==============

/**
 * Payment Required Response body for HTTP 402
 */
export interface PaymentRequiredResponse {
  /** x402 protocol version */
  x402Version: number;
  /** List of acceptable payment options */
  accepts: PaymentRequirements[];
  /** Error message if applicable */
  error?: string;
}

// ============== Job Types ==============

/**
 * X402 Payment Job status
 */
export type X402PaymentStatus =
  | 'pending'
  | 'payment_required'
  | 'payment_received'
  | 'verifying'
  | 'verified'
  | 'settling'
  | 'settled'
  | 'completed'
  | 'failed'
  | 'expired';

/**
 * X402 Payment Job
 */
export interface X402PaymentJob {
  /** Unique job identifier */
  jobId: string;
  /** Order ID from the business system */
  orderId: string;
  /** Amount in USD (human readable) */
  amountUsd: number;
  /** Amount in atomic units */
  amountAtomic: string;
  /** Resource being paid for */
  resource: string;
  /** Description */
  description: string;
  /** Current status */
  status: X402PaymentStatus;
  /** Payment requirements sent to client */
  paymentRequirements?: PaymentRequirements;
  /** Received payment payload */
  paymentPayload?: PaymentPayload;
  /** Verification result */
  verifyResponse?: VerifyResponse;
  /** Settlement result */
  settleResponse?: SettleResponse;
  /** Created timestamp */
  createdAt: Date;
  /** Updated timestamp */
  updatedAt: Date;
  /** Expiration timestamp */
  expiresAt: Date;
  /** Error message if failed */
  errorMessage?: string;
  /** Whether manual confirmation is required */
  requiresManualConfirmation: boolean;
  /** Manual confirmation status */
  manuallyConfirmed?: boolean;
  /** Manual confirmation timestamp */
  confirmedAt?: Date;
  /** Confirmer identifier */
  confirmedBy?: string;
  /** Selected payment method */
  paymentMethod?: PaymentMethodType;
  /** Fiat amount when QR is offered */
  fiatAmount?: number;
  /** Last generated QR (IPFS link) */
  fiatQrIpfsLink?: string;
}

// ============== Webhook Types ==============

/**
 * X402 Webhook event types
 */
export type X402WebhookEventType =
  | 'X402_PAYMENT_REQUIRED'
  | 'X402_PAYMENT_RECEIVED'
  | 'X402_PAYMENT_VERIFIED'
  | 'X402_PAYMENT_SETTLED'
  | 'X402_PAYMENT_CONFIRMED'
  | 'X402_PAYMENT_FAILED'
  | 'X402_PAYMENT_EXPIRED';

/**
 * X402 Webhook payload
 */
export interface X402WebhookPayload {
  type: X402WebhookEventType;
  orderId: string;
  jobId: string;
  data: {
    status: X402PaymentStatus;
    paymentRequirements?: PaymentRequirements;
    verifyResponse?: VerifyResponse;
    settleResponse?: SettleResponse;
    txHash?: string;
    blockExplorerUrl?: string;
    amountUsd?: number;
    payer?: string;
    error?: string;
    timestamp: string;
  };
}

// ============== Utility Types ==============

/**
 * Convert USD amount to stroops (7 decimals for Stellar)
 */
export function usdToAtomic(usdAmount: number): string {
  const atomicAmount = BigInt(Math.floor(usdAmount * 10_000_000));
  return atomicAmount.toString();
}

/**
 * Convert stroops to USD amount
 */
export function atomicToUsd(atomicAmount: string): number {
  return Number(BigInt(atomicAmount)) / 10_000_000;
}

/**
 * Generate a random nonce for Stellar payments
 */
export function generateNonce(): string {
  return crypto.randomUUID();
}

/**
 * Encode payment payload to base64 for X-PAYMENT header
 */
export function encodePaymentHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Decode X-PAYMENT header from base64
 */
export function decodePaymentHeader(encoded: string): PaymentPayload {
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  return JSON.parse(decoded) as PaymentPayload;
}

export function isCryptoPaymentPayload(
  payload: PaymentPayload,
): payload is CryptoPaymentPayload {
  return (payload as CryptoPaymentPayload).scheme !== undefined;
}

export function isFiatPaymentPayload(
  payload: PaymentPayload,
): payload is FiatPaymentPayload {
  return payload.type === 'fiat';
}

/**
 * Encode settlement response for X-PAYMENT-RESPONSE header
 */
export function encodeSettlementHeader(
  response: SettlementResponse,
): string {
  return Buffer.from(JSON.stringify(response)).toString('base64');
}

/**
 * Decode settlement response for downstream processing
 */
export function decodeSettlementHeader(encoded: string): SettlementResponse {
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  return JSON.parse(decoded) as SettlementResponse;
}
