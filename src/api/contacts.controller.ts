import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { SessionManager } from '../core/abc/manager.abc';
import { UnifiedAuthGuard } from '../core/auth/unified-auth.guard';
import { RolesGuard, PermissionsGuard } from '../core/auth/roles.guard';
import { CanReadSessions, CanManageSessions } from '../core/auth/auth.decorators';
import { SessionQuery } from '../structures/base.dto';
import {
  CheckNumberStatusQuery,
  WANumberExistResult,
} from '../structures/chatting.dto';
import {
  ContactProfilePictureQuery,
  ContactQuery,
  ContactRequest,
  ContactsPaginationParams,
} from '../structures/contacts.dto';

@ApiSecurity('api_key')
@ApiBearerAuth()
@UseGuards(UnifiedAuthGuard, RolesGuard, PermissionsGuard)
@Controller('api/contacts')
@ApiTags('👤 Contacts')
export class ContactsController {
  constructor(private manager: SessionManager) {}

  @Get('/all')
  @ApiOperation({ summary: 'Get all contacts' })
  @CanReadSessions()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getAll(
    @Query() query: SessionQuery,
    @Query() pagination: ContactsPaginationParams,
  ) {
    const whatsapp = await this.manager.getWorkingSession(query.session);
    return whatsapp.getContacts(pagination);
  }

  @Get('/')
  @ApiOperation({
    summary: 'Get contact basic info',
    description:
      'The method always return result, even if the phone number is not registered in WhatsApp. For that - use /contacts/check-exists endpoint below.',
  })
  async get(@Query() query: ContactQuery) {
    const whatsapp = await this.manager.getWorkingSession(query.session);
    return whatsapp.getContact(query);
  }

  @Get('/check-exists')
  @ApiOperation({ summary: 'Check phone number is registered in WhatsApp.' })
  async checkExists(
    @Query() request: CheckNumberStatusQuery,
  ): Promise<WANumberExistResult> {
    const whatsapp = await this.manager.getWorkingSession(request.session);
    return whatsapp.checkNumberStatus(request);
  }

  @Get('/about')
  @ApiOperation({
    summary: 'Gets the Contact\'s "about" info',
    description:
      'Returns null if you do not have permission to read their status.',
  })
  async getAbout(@Query() query: ContactQuery) {
    const whatsapp = await this.manager.getWorkingSession(query.session);
    return whatsapp.getContactAbout(query);
  }

  @Get('/profile-picture')
  @ApiOperation({
    summary: "Get contact's profile picture URL",
    description:
      'If privacy settings do not allow to get the picture, the method will return null.',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getProfilePicture(@Query() query: ContactProfilePictureQuery) {
    const whatsapp = await this.manager.getWorkingSession(query.session);
    const url = await whatsapp.getContactProfilePicture(
      query.contactId,
      query.refresh,
    );
    return { profilePictureURL: url };
  }

  @Post('/block')
  @ApiOperation({ summary: 'Block contact' })
  @CanManageSessions()
  async block(@Body() request: ContactRequest) {
    const whatsapp = await this.manager.getWorkingSession(request.session);
    return whatsapp.blockContact(request);
  }

  @Post('/unblock')
  @ApiOperation({ summary: 'Unblock contact' })
  @CanManageSessions()
  async unblock(@Body() request: ContactRequest) {
    const whatsapp = await this.manager.getWorkingSession(request.session);
    return whatsapp.unblockContact(request);
  }
}
