import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { createCanvas, loadImage, registerFont } from 'canvas';
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
  private readonly fontPath = path.join(this.assetsDir, 'fonts', 'StackSansHeadline.ttf');

  constructor(private readonly configService: ConfigService) {
    this.ensureDirectories();
    this.registerFonts();
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

  private registerFonts(): void {
    try {
      // Register custom font if it exists
      if (require('fs').existsSync(this.fontPath)) {
        registerFont(this.fontPath, { family: 'StackSansHeadline' });
      }
    } catch (error) {
      this.logger.warn('Could not register custom font, using default', error);
    }
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
    // Create canvas 800x1000px
    const canvas = createCanvas(800, 1000);
    const ctx = canvas.getContext('2d');

    // Background color: black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 800, 1000);

    // Load and draw QR at top (0, 0)
    const qrImage = await loadImage(qrBuffer);
    ctx.drawImage(qrImage, 0, 0, 800, 800);

    // Bottom section (800x200px) - white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 800, 800, 200);

    // Text styling
    const fontFamily = require('fs').existsSync(this.fontPath)
      ? 'StackSansHeadline'
      : 'Arial';

    // "PasaTanda" centered at ~850px
    ctx.fillStyle = '#000000';
    ctx.font = `bold 48px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText('PasaTanda', 400, 860);

    // Left column: "Grupo:"
    ctx.font = `32px ${fontFamily}`;
    ctx.textAlign = 'left';
    ctx.fillText('Grupo:', 50, 930);

    // Right column: "Monto:"
    ctx.textAlign = 'right';
    ctx.fillText('Monto:', 350, 930);

    // Left column: Group name
    ctx.font = `bold 28px ${fontFamily}`;
    ctx.textAlign = 'left';
    ctx.fillText(groupName, 50, 970);

    // Right column: Amount
    ctx.textAlign = 'right';
    ctx.fillText(`Bs. ${amountBs}`, 750, 970);

    // Convert canvas to buffer
    return canvas.toBuffer('image/png');
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
