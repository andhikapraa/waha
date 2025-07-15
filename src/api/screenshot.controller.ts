import {
  Controller,
  Get,
  Query,
  Res,
  StreamableFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ApiFileAcceptHeader } from '@waha/nestjs/ApiFileAcceptHeader';
import { Response } from 'express';

import { SessionManager } from '../core/abc/manager.abc';
import { BufferResponseInterceptor } from '../nestjs/BufferResponseInterceptor';
import { SessionQuery } from '../structures/base.dto';
import { UnifiedAuthGuard } from '../core/auth/unified-auth.guard';
import { RolesGuard, PermissionsGuard } from '../core/auth/roles.guard';
import { CanReadSessions } from '../core/auth/auth.decorators';

@ApiSecurity('api_key')
@ApiBearerAuth()
@UseGuards(UnifiedAuthGuard, RolesGuard, PermissionsGuard)
@Controller('api')
@ApiTags('🖼️ Screenshot')
export class ScreenshotController {
  constructor(private manager: SessionManager) {}

  @Get('/screenshot')
  @UseInterceptors(new BufferResponseInterceptor('image/jpeg'))
  @ApiFileAcceptHeader('image/jpeg')
  @CanReadSessions()
  async screenshot(
    @Res({ passthrough: true }) res: Response,
    @Query() sessionQuery: SessionQuery,
  ) {
    const whatsappService = this.manager.getSession(sessionQuery.session);
    return await whatsappService.getScreenshot();
  }
}
