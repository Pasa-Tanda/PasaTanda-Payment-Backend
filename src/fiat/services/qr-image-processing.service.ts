import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import FormData from 'form-data';

/**
 * QR Image Processing Service
 *
 * Processes bank QR codes with the following steps:
 * 1. Crop QR to show only the QR code
 * 2. Invert colors
 * 3. Scale to 800x800px
 * 4. Add logo at center (200px)
 * 5. Apply to HTML template
 * 6. Convert to image (800x1000px)
 * 7. Upload to IPFS via Pinata
 * 8. Save to local tmp/qr-tests
 */
@Injectable()
export class QrImageProcessingService {
  private readonly logger = new Logger(QrImageProcessingService.name);
  private readonly tmpDir = path.join(process.cwd(), 'tmp', 'qr-tests');
  private readonly assetsDir = path.join(process.cwd(), 'assets');
  private readonly logoPath = path.join(this.assetsDir, 'images', 'TandaPaso_logo_QR.png');

  constructor(private readonly configService: ConfigService) {
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    try {
      await fs.mkdir(this.tmpDir, { recursive: true });
      await fs.mkdir(this.assetsDir + '/images', { recursive: true });
      await fs.mkdir(this.assetsDir + '/fonts', { recursive: true });
    } catch (error) {
      this.logger.error('Error creating directories', error);
    }
  }

  private escapeSvg(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Process QR image from base64:
   * - Crop (dimensions: x=16, y=16, width=356, height=356)
   * - Invert colors
   * - Scale to 800x800px
   * - Add centered logo (200px)
   */
  async processQrImage(
    base64Qr: string,
    groupName: string,
    amountBs: string,
  ): Promise<{  ipfsUrl?: string; savedPath?: string; error?: string }> {
    try {
      // 1. Decode base64 to buffer
      const qrBuffer = Buffer.from(base64Qr, 'base64');

      // 2. Crop QR (x=16, y=16, width=356, height=356)
      let processedQr = await sharp(qrBuffer)
        .extract({ left: 16, top: 16, width: 356, height: 356 })
        .toBuffer();

      // 3. Invert colors
      processedQr = await sharp(processedQr)
        .negate({ alpha: false })
        .toBuffer();

      // 4. Scale to 800x800px
      processedQr = await sharp(processedQr)
        .resize(800, 800, {
          fit: 'fill',
          kernel: sharp.kernel.nearest, // Use nearest neighbor for QR codes
        })
        .toBuffer();

      // 5. Add logo at center if exists
      if (require('fs').existsSync(this.logoPath)) {
        const logo = await sharp(this.logoPath)
          .resize(200, 200, { fit: 'inside' })
          .toBuffer();

        // Composite logo at center (800-200)/2 = 300px offset
        processedQr = await sharp(processedQr)
          .composite([
            {
              input: logo,
              top: 300,
              left: 300,
            },
          ])
          .toBuffer();
      }

      // 6. Create HTML template with the QR
      const finalImage = await this.createQrTemplate(
        processedQr,
        groupName,
        amountBs,
      );

      // 7. Save to tmp/qr-tests
      const timestamp = Date.now();
      const filename = `qr_${groupName.replace(/\s+/g, '_')}_${timestamp}.png`;
      const savedPath = path.join(this.tmpDir, filename);
      await fs.writeFile(savedPath, finalImage);

      // 8. Upload to IPFS
      const ipfsUrl = await this.uploadToIPFS(finalImage, filename);

      return { ipfsUrl, savedPath };
    } catch (error) {
      this.logger.error('Error processing QR image', error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create QR template matching templateqrstatement.png design
   * Final size: 800x1000px
   */
  private async createQrTemplate(
    qrBuffer: Buffer,
    groupName: string,
    amountBs: string,
  ): Promise<Buffer> {
    const qrPng = await sharp(qrBuffer).png().toBuffer();
    const qrDataUrl = `data:image/png;base64,${qrPng.toString('base64')}`;
    const safeGroup = this.escapeSvg(groupName);
    const safeAmount = this.escapeSvg(amountBs);

    const qrSize = 760;
    const margin = 20;

    const svg = `
      <svg width="800" height="1000" viewBox="0 0 800 1000" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>
            .title { font: 48px 'Helvetica Neue', Arial, sans-serif; font-weight: 700; fill: #000; }
            .label { font: 32px 'Helvetica Neue', Arial, sans-serif; font-weight: 400; fill: #000; }
            .value { font: 32px 'Helvetica Neue', Arial, sans-serif; font-weight: 700; fill: #000; }
          </style>
        </defs>
        <rect width="800" height="1000" fill="#000" />
        <rect x="${margin - 10}" y="${margin - 10}" width="${qrSize + 20}" height="${qrSize + 20}" fill="none" stroke="#FFF" stroke-width="10" />
        <image href="${qrDataUrl}" x="${margin}" y="${margin}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />
        <rect x="0" y="800" width="800" height="200" fill="#FFF" />
        <text x="400" y="860" text-anchor="middle" class="title">PasaTanda</text>
        <text x="50" y="930" text-anchor="start" class="label">Grupo:</text>
        <text x="350" y="930" text-anchor="end" class="label">Monto:</text>
        <text x="50" y="970" text-anchor="start" class="value">${safeGroup}</text>
        <text x="750" y="970" text-anchor="end" class="value">Bs. ${safeAmount}</text>
      </svg>
    `;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Upload image to IPFS via Pinata Cloud
   */
  private async uploadToIPFS(
    imageBuffer: Buffer,
    filename: string,
  ): Promise<string> {
    const apiKey = this.configService.get<string>('IPFS_API_KEY');
    const apiSecret = this.configService.get<string>('IPFS_API_SECRET');
    const groupId = this.configService.get<string>('IPFS_GROUP_ID');

    if (!apiKey || !apiSecret) {
      throw new Error('IPFS credentials not configured');
    }

    try {
      const formData = new FormData();
      formData.append('file', imageBuffer, {
        filename,
        contentType: 'image/png',
      });

      // Add metadata
      const metadata = JSON.stringify({
        name: filename,
        keyvalues: {
          type: 'qr_payment',
          timestamp: Date.now().toString(),
        },
      });
      formData.append('pinataMetadata', metadata);

      // Add to group if specified
      if (groupId) {
        const options = JSON.stringify({
          groupId,
        });
        formData.append('pinataOptions', options);
      }

      const response = await axios.post(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            pinata_api_key: apiKey,
            pinata_secret_api_key: apiSecret,
          },
          maxBodyLength: Infinity,
        },
      );

      const ipfsHash = response.data.IpfsHash;
      return `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
    } catch (error) {
      this.logger.error('Error uploading to IPFS', error);
      throw error;
    }
  }

  /**
   * Get default QR link when generation fails
   */
  getDefaultQrLink(): string {
    return (
      this.configService.get<string>('DEFAULT_QR_IPFS_LINK') ||
      'https://gateway.pinata.cloud/ipfs/QmDefault'
    );
  }
}
