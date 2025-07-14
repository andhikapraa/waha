import { Controller, Get, Res, Req, Next } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { join } from 'path';
import { readFileSync } from 'fs';

@Controller('dashboard/auth')
export class DashboardAuthController {
  private indexHtml: string;

  constructor() {
    // Load the index.html file once at startup
    try {
      const indexPath = join(__dirname, '..', 'dashboard', 'auth', 'index.html');
      this.indexHtml = readFileSync(indexPath, 'utf8');
    } catch (error) {
      console.error('Failed to load dashboard auth index.html:', error);
      this.indexHtml = '<html><body><h1>Dashboard Auth UI not found</h1></body></html>';
    }
  }

  @Get('*path')
  serveSPA(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction): any {
    const path = req.path;

    // Don't handle asset files - let static file serving handle them
    if (path.includes('/assets/') || path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.ico')) {
      // Pass control to the next middleware (static file serving)
      return next();
    }

    // Check if response has already been sent to prevent header errors
    if (res.headersSent) {
      return;
    }

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(this.indexHtml);
  }
}
