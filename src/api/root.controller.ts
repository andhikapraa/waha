import { 
  Controller, 
  Get, 
  Res, 
  UseGuards,
  Req
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { UnifiedAuthGuard } from '../core/auth/unified-auth.guard';
import { RolesGuard } from '../core/auth/roles.guard';
import { Public } from '../core/auth/auth.decorators';

@Controller('/')
@ApiTags('🏠 Root')
export class RootController {

  @Get()
  @Public()
  @ApiOperation({ 
    summary: 'Root endpoint',
    description: 'Shows API information and authentication status. Public endpoint that redirects to appropriate interface.'
  })
  getRoot(@Req() req: Request, @Res() res: Response): void {
    // Check if user is authenticated by looking for Authorization header
    const authHeader = req.headers.authorization;
    const isAuthenticated = authHeader && authHeader.startsWith('Bearer ');
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WAHA - WhatsApp HTTP API</title>
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
            font-size: 64px;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            margin-bottom: 10px;
        }
        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 18px;
        }
        .security-notice {
            background: ${isAuthenticated ? '#e8f5e8' : '#fff3cd'};
            color: ${isAuthenticated ? '#2d5a2d' : '#856404'};
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            border-left: 4px solid ${isAuthenticated ? '#4caf50' : '#ffc107'};
        }
        .actions {
            margin-top: 30px;
        }
        .actions a {
            display: inline-block;
            margin: 10px;
            padding: 12px 24px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            transition: background 0.3s;
            font-weight: 500;
        }
        .actions a:hover {
            background: #5a6fd8;
        }
        .actions a.primary {
            background: #4caf50;
        }
        .actions a.primary:hover {
            background: #45a049;
        }
        .version {
            margin-top: 30px;
            color: #666;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🚀</div>
        <h1>WAHA</h1>
        <div class="subtitle">WhatsApp HTTP API</div>
        
        <div class="security-notice">
            ${isAuthenticated 
              ? '✅ <strong>Authenticated Access</strong><br>You have valid authentication credentials.'
              : '🔐 <strong>Authentication Required</strong><br>This API requires authentication for access to WhatsApp functionality.'
            }
        </div>
        
        <div class="actions">
            ${isAuthenticated 
              ? '<a href="/dashboard" class="primary">📊 Dashboard</a>'
              : '<a href="/dashboard/auth" class="primary">🔐 Login</a>'
            }
            <a href="/">📚 API Documentation</a>
            ${isAuthenticated 
              ? '<a href="/api/sessions">📱 Sessions</a>'
              : ''
            }
        </div>
        
        <div class="version">
            WAHA v2025.7.5 - Enhanced Security Mode<br>
            ${isAuthenticated ? 'Secure Access Granted' : 'Authentication Required'}
        </div>
    </div>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(html);
  }
}
