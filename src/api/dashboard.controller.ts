import { 
  Controller, 
  Get, 
  Res, 
  Req, 
  Next, 
  UseGuards,
  ForbiddenException 
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';

import { UnifiedAuthGuard } from '../core/auth/unified-auth.guard';
import { RolesGuard } from '../core/auth/roles.guard';
import { AdminOrManager } from '../core/auth/auth.decorators';

@Controller('dashboard')
@UseGuards(UnifiedAuthGuard, RolesGuard)
@ApiBearerAuth()
@ApiTags('🖥️ Dashboard')
export class DashboardController {
  private indexHtml: string;

  constructor() {
    // Load the main dashboard index.html file once at startup
    try {
      const indexPath = join(__dirname, '..', 'dashboard', 'index.html');
      if (existsSync(indexPath)) {
        this.indexHtml = readFileSync(indexPath, 'utf8');
      } else {
        // Fallback for development when dashboard files might not be present
        this.indexHtml = this.generateFallbackDashboard();
      }
    } catch (error) {
      console.error('Failed to load dashboard index.html:', error);
      this.indexHtml = this.generateFallbackDashboard();
    }
  }

  @Get('*path')
  @AdminOrManager()
  @ApiOperation({ 
    summary: 'Serve secure dashboard',
    description: 'Serves the main dashboard interface. Requires authentication and admin/manager role.'
  })
  serveDashboard(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction): any {
    const path = req.path;

    // Don't handle auth routes - they have their own controller
    if (path.startsWith('/dashboard/auth')) {
      return next();
    }

    // Don't handle asset files - let static file serving handle them
    if (path.includes('/assets/') || 
        path.endsWith('.js') || 
        path.endsWith('.css') || 
        path.endsWith('.ico') ||
        path.endsWith('.svg') ||
        path.endsWith('.png') ||
        path.endsWith('.jpg') ||
        path.endsWith('.jpeg')) {
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

  private generateFallbackDashboard(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WAHA Dashboard - Secure Access</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 600px;
        }
        .logo {
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        .status {
            background: #e8f5e8;
            color: #2d5a2d;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            border-left: 4px solid #4caf50;
        }
        .info {
            background: #e3f2fd;
            color: #1565c0;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            border-left: 4px solid #2196f3;
        }
        .api-links {
            margin-top: 30px;
        }
        .api-links a {
            display: inline-block;
            margin: 10px;
            padding: 10px 20px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            transition: background 0.3s;
        }
        .api-links a:hover {
            background: #5a6fd8;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🚀</div>
        <h1>WAHA Dashboard</h1>
        <p>WhatsApp HTTP API - Secure Access</p>
        
        <div class="status">
            ✅ <strong>Authentication Enabled</strong><br>
            You are successfully authenticated and authorized to access this dashboard.
        </div>
        
        <div class="info">
            ℹ️ <strong>Dashboard Files</strong><br>
            The full dashboard interface is not available in development mode.<br>
            In production, this would show the complete WAHA management interface.
        </div>
        
        <div class="api-links">
            <a href="/api/sessions">📱 Sessions API</a>
            <a href="/api/auth/me">👤 User Info</a>
            <a href="/">📚 API Documentation</a>
            <a href="/dashboard/auth">🔐 Login Page</a>
        </div>
        
        <p style="margin-top: 30px; color: #666; font-size: 14px;">
            WAHA v2025.7.5 - Enhanced Security Mode
        </p>
    </div>
</body>
</html>
    `;
  }
}
