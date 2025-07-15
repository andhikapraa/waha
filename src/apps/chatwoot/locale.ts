import * as fs from 'fs-extra';
import * as lodash from 'lodash';
import * as Mustache from 'mustache';
import * as path from 'path';
import * as yaml from 'yaml';

export enum LocaleCode {
  EN_US = 'en-US',
  AR_AE = 'ar-AE',
  BN_BD = 'bn-BD',
  PT_BR = 'pt-BR',
  DE_DE = 'de-DE',
  ES_ES = 'es-ES',
  FR_FR = 'fr-FR',
  ID_ID = 'id-ID',
  HE_IL = 'he-IL',
  HI_IN = 'hi-IN',
  FA_IR = 'fa-IR',
  PA_PK = 'pa-PK',
  RU_RU = 'ru-RU',
  TR_TR = 'tr-TR',
  UK_UA = 'uk-UA',
}

export const LOCALES = [
  LocaleCode.EN_US,
  LocaleCode.AR_AE,
  LocaleCode.BN_BD,
  LocaleCode.PT_BR,
  LocaleCode.DE_DE,
  LocaleCode.ES_ES,
  LocaleCode.FR_FR,
  LocaleCode.ID_ID,
  LocaleCode.HE_IL,
  LocaleCode.HI_IN,
  LocaleCode.FA_IR,
  LocaleCode.PA_PK,
  LocaleCode.RU_RU,
  LocaleCode.TR_TR,
  LocaleCode.UK_UA,
];

export const LOCALE_NAMES: Record<LocaleCode, string> = {
  [LocaleCode.EN_US]: '🇺🇸 English (English)',
  [LocaleCode.AR_AE]: '🇦🇪 العربية (Arabic)',
  [LocaleCode.BN_BD]: '🇧🇩 বাংলা (Bengali)',
  [LocaleCode.PT_BR]: '🇧🇷🇵🇹 Português (Portuguese)',
  [LocaleCode.DE_DE]: '🇩🇪 Deutsch (German)',
  [LocaleCode.ES_ES]: '🇪🇸 Español (Spanish)',
  [LocaleCode.FR_FR]: '🇫🇷 Français (French)',
  [LocaleCode.ID_ID]: '🇮🇩 Bahasa Indonesia (Indonesian)',
  [LocaleCode.HE_IL]: '🇮🇱 עברית (Hebrew)',
  [LocaleCode.HI_IN]: '🇮🇳 हिंदी (Hindi)',
  [LocaleCode.FA_IR]: '🇮🇷 فارسی (Persian)',
  [LocaleCode.PA_PK]: '🇵🇰 ਪੰਜਾਬੀ (Punjabi)',
  [LocaleCode.RU_RU]: '🇷🇺 Русский (Russian)',
  [LocaleCode.TR_TR]: '🇹🇷 Türkçe (Turkish)',
  [LocaleCode.UK_UA]: '🇺🇦 Українська (Ukrainian)',
};
export const DEFAULT_LOCALE = 'en-US';

function loadTemplateStrings(locale: string) {
  const filename = `${locale}.yaml`;
  
  // Check if we're running from the dist directory
  const isDist = __dirname.includes('/dist/');
  
  let yamlPath;
  if (isDist) {
    // In production (dist), the files are in /dist/apps/chatwoot/i18n/
    // Remove any 'src' from the path if it exists
    const basePath = __dirname.includes('/dist/src/') 
      ? __dirname.replace('/dist/src/', '/dist/') 
      : __dirname;
    yamlPath = path.join(basePath, 'i18n', filename);
    
    // If the file doesn't exist at the calculated path, try the alternative path
    if (!fs.existsSync(yamlPath)) {
      const altPath = path.join(process.cwd(), 'dist', 'apps', 'chatwoot', 'i18n', filename);
      if (fs.existsSync(altPath)) {
        yamlPath = altPath;
      }
    }
  } else {
    // In development, use the regular path
    yamlPath = path.join(__dirname, 'i18n', filename);
  }
  
  // Log the path being used (helpful for debugging)
  console.log(`Loading locale file from: ${yamlPath}`);
  
  const content = fs.readFileSync(yamlPath, 'utf-8');
  return yaml.parse(content);
}

export interface Link {
  text: string;
  url: string;
}

function loadLocales(locales: string[]) {
  const defaults = loadTemplateStrings(DEFAULT_LOCALE);
  const result: Record<string, Record<string, string>> = {};
  for (const locale of locales) {
    const strings = loadTemplateStrings(locale);
    result[locale] = lodash.merge({}, defaults, strings);
  }
  return result;
}

let locales: Record<string, Record<string, string>> = {};
try {
  locales = loadLocales(LOCALES);
} catch (error) {
  console.error('Error loading locales:', error);
  process.exit(1);
}

export enum TKey {
  WHATSAPP_ERROR_SENDING_MESSAGE = 'WHATSAPP_ERROR_SENDING_MESSAGE',
  WHATSAPP_ERROR_RECEIVING_MESSAGE = 'WHATSAPP_ERROR_RECEIVING_MESSAGE',
  WHATSAPP_ERROR_REMOVING_MESSAGE = 'WHATSAPP_ERROR_REMOVING_MESSAGE',
  JOB_ERROR_REPORT = 'JOB_ERROR_REPORT',
  JOB_SUCCEEDED_REPORT = 'JOB_SUCCEEDED_REPORT',
  MESSAGE_FROM_WHATSAPP = 'MESSAGE_FROM_WHATSAPP',
  MESSAGE_FROM_API = 'MESSAGE_FROM_API',
  MESSAGE_REMOVED_IN_WHATSAPP = 'MESSAGE_REMOVED_IN_WHATSAPP',
  MESSAGE_EDITED_IN_WHATSAPP = 'MESSAGE_EDITED_IN_WHATSAPP',
  WHATSAPP_GROUP_MESSAGE = 'WHATSAPP_GROUP_MESSAGE',
  WHATSAPP_REACTION_ADDED = 'WHATSAPP_REACTION_ADDED',
  WHATSAPP_REACTION_REMOVED = 'WHATSAPP_REACTION_REMOVED',
  //
  // Contact Suffixes
  //
  WHATSAPP_CONTACT_GROUP_SUFFIX = 'WHATSAPP_CONTACT_GROUP_SUFFIX',
  WHATSAPP_CONTACT_CHANNEL_SUFFIX = 'WHATSAPP_CONTACT_CHANNEL_SUFFIX',
  WHATSAPP_CONTACT_STATUS_NAME = 'WHATSAPP_CONTACT_STATUS_NAME',

  //
  // App Inbox
  //
  APP_INBOX_CONTACT_NAME = 'APP_INBOX_CONTACT_NAME',
  APP_INBOX_CONTACT_AVATAR_URL = 'APP_INBOX_CONTACT_AVATAR_URL',
  APP_CONNECTED_MESSAGE = 'APP_CONNECTED_MESSAGE',
  APP_DISCONNECTED_MESSAGE = 'APP_DISCONNECTED_MESSAGE',
  APP_UPDATED_MESSAGE = 'APP_UPDATED_MESSAGE',
  APP_COMMANDS_LIST = 'APP_COMMANDS_LIST',
  APP_HELP_REMINDER = 'APP_HELP_REMINDER',
  APP_SESSION_STATUS_CHANGE = 'APP_SESSION_STATUS_CHANGE',
  APP_SESSION_CURRENT_STATUS = 'APP_SESSION_CURRENT_STATUS',
  APP_DASHBOARD_LINK = 'APP_DASHBOARD_LINK',
  APP_SESSION_STATUS_WORKING = 'APP_SESSION_STATUS_WORKING',
  APP_SESSION_STATUS_ERROR = 'APP_SESSION_STATUS_ERROR',
  APP_SESSION_SCAN_QR_CODE = 'APP_SESSION_SCAN_QR_CODE',
  APP_SERVER_VERSION_AND_STATUS = 'APP_SERVER_VERSION_AND_STATUS',
  APP_SERVER_REBOOT = 'APP_SERVER_REBOOT',
  APP_SERVER_REBOOT_FORCE = 'APP_SERVER_REBOOT_FORCE',
  APP_LOGOUT_SUCCESS = 'APP_LOGOUT_SUCCESS',
  APP_NEW_VERSION_AVAILABLE = 'APP_NEW_VERSION_AVAILABLE',
  APP_CORE_VERSION_USED = 'APP_CORE_VERSION_USED',
  APP_SCHEDULED_JOB_ERROR = 'APP_SCHEDULED_JOB_ERROR',
}

// Define payload types
type TemplatePayloads = {
  [TKey.APP_INBOX_CONTACT_NAME]: void;
  [TKey.APP_INBOX_CONTACT_AVATAR_URL]: void;
  [TKey.MESSAGE_FROM_WHATSAPP]: { text: string };
  [TKey.MESSAGE_FROM_API]: { text: string };
  [TKey.MESSAGE_REMOVED_IN_WHATSAPP]: void;
  [TKey.MESSAGE_EDITED_IN_WHATSAPP]: { text: string };
  [TKey.WHATSAPP_GROUP_MESSAGE]: { text: string; participant: string };
  [TKey.WHATSAPP_REACTION_ADDED]: { emoji: string };
  [TKey.WHATSAPP_REACTION_REMOVED]: void;
  [TKey.WHATSAPP_ERROR_SENDING_MESSAGE]: void;
  [TKey.WHATSAPP_ERROR_RECEIVING_MESSAGE]: void;
  [TKey.WHATSAPP_ERROR_REMOVING_MESSAGE]: void;
  [TKey.WHATSAPP_CONTACT_GROUP_SUFFIX]: void;
  [TKey.WHATSAPP_CONTACT_CHANNEL_SUFFIX]: void;
  [TKey.WHATSAPP_CONTACT_STATUS_NAME]: void;
  [TKey.APP_SCHEDULED_JOB_ERROR]: void;
  [TKey.JOB_ERROR_REPORT]: {
    header: string;
    error: string;
    details: Link;
    attempts: {
      current: number;
      max: number;
      nextDelay?: number;
    };
  };
  [TKey.JOB_SUCCEEDED_REPORT]: {
    details: Link;
    attempts: {
      current: number;
      max: number;
    };
  };
  [TKey.APP_CONNECTED_MESSAGE]: { name: string };
  [TKey.APP_DISCONNECTED_MESSAGE]: { name: string };
  [TKey.APP_UPDATED_MESSAGE]: { name: string };
  [TKey.APP_SESSION_STATUS_CHANGE]: {
    emoji: string;
    session: string;
    status: string;
  };
  [TKey.APP_SESSION_CURRENT_STATUS]: {
    emoji: string;
    session: string;
    status: string;
    name: string;
    id: string;
  };
  [TKey.APP_DASHBOARD_LINK]: { url: string };
  [TKey.APP_SESSION_STATUS_WORKING]: { name: string; id: string };
  [TKey.APP_SESSION_STATUS_ERROR]: void;
  [TKey.APP_SESSION_SCAN_QR_CODE]: void;
  [TKey.APP_HELP_REMINDER]: void;
  [TKey.APP_COMMANDS_LIST]: void;
  [TKey.APP_SERVER_VERSION_AND_STATUS]: { version: string; status: string };
  [TKey.APP_SERVER_REBOOT]: void;
  [TKey.APP_SERVER_REBOOT_FORCE]: void;
  [TKey.APP_LOGOUT_SUCCESS]: void;
  [TKey.APP_NEW_VERSION_AVAILABLE]: {
    currentVersion: string;
    newVersion: string;
    changelogUrl: string;
  };
  [TKey.APP_CORE_VERSION_USED]: {
    supportUrl: string;
  };
};

export class Locale {
  private readonly strings: Record<string, string>;

  constructor(locale: string = DEFAULT_LOCALE) {
    locale = locale || DEFAULT_LOCALE;
    if (!locales[locale]) {
      throw new Error(`Locale '${locale}' not found`);
    }
    this.strings = locales[locale];
  }

  key<K extends TKey>(key: K): Template<K> {
    return new Template(this.strings[key] || key);
  }
}

export class Template<K extends TKey> {
  constructor(private readonly template: string) {}

  render(data: TemplatePayloads[K]): string {
    return Mustache.render(this.template, data);
  }

  r(data: TemplatePayloads[K]): string {
    return this.render(data);
  }
}
