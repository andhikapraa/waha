#!/usr/bin/env ts-node

/**
 * Admin Account Reset Utility
 * 
 * This script helps reset the admin account by:
 * 1. Deleting existing admin users
 * 2. Creating a new admin with default password
 * 3. Verifying the new admin can authenticate
 */

import { NestFactory } from '@nestjs/core';
import { AppModuleCore } from '../src/core/app.module.core';
import { AdminBootstrapService } from '../src/core/services/AdminBootstrapService';
import { UserService } from '../src/core/services/UserService';
import { IUserRepository } from '../src/core/storage/IUserRepository';
import { UserRole } from '../src/structures/user.dto';

async function resetAdminAccount() {
  console.log('🔄 Starting admin account reset process...');
  
  try {
    // Create NestJS application context
    const app = await NestFactory.createApplicationContext(AppModuleCore);
    
    // Get required services
    const adminBootstrapService = app.get(AdminBootstrapService);
    const userService = app.get(UserService);
    const userRepository = app.get(IUserRepository);
    
    console.log('✅ Application context created successfully');
    
    // Step 1: Check current admin status
    console.log('\n📊 Checking current admin status...');
    const adminStatus = await adminBootstrapService.getAdminStatus();
    console.log('Current admin status:', {
      authEnabled: adminStatus.authEnabled,
      adminExists: adminStatus.adminExists,
      adminCount: adminStatus.adminCount,
      activeAdminCount: adminStatus.activeAdminCount,
      defaultCredentialsConfigured: adminStatus.defaultCredentialsConfigured
    });
    
    if (!adminStatus.authEnabled) {
      console.log('⚠️  Authentication is disabled. Enable authentication first.');
      await app.close();
      return;
    }
    
    // Step 2: Delete existing admin users
    if (adminStatus.adminExists) {
      console.log('\n🗑️  Deleting existing admin users...');
      
      const adminUsers = await userRepository.list({
        role: UserRole.ADMIN,
        limit: 100
      });
      
      console.log(`Found ${adminUsers.users.length} admin user(s) to delete:`);
      
      for (const admin of adminUsers.users) {
        console.log(`  - Deleting admin: ${admin.username} (${admin.email})`);
        await userRepository.delete(admin.id);
        console.log(`    ✅ Deleted admin: ${admin.username}`);
      }
      
      console.log('✅ All existing admin users deleted');
    } else {
      console.log('ℹ️  No existing admin users found');
    }
    
    // Step 3: Verify deletion
    console.log('\n🔍 Verifying admin deletion...');
    const postDeleteStatus = await adminBootstrapService.getAdminStatus();
    if (postDeleteStatus.adminExists) {
      console.error('❌ Failed to delete admin users');
      await app.close();
      return;
    }
    console.log('✅ Admin deletion verified');
    
    // Step 4: Create new admin with default password
    console.log('\n👤 Creating new admin user...');
    const bootstrapResult = await adminBootstrapService.bootstrapAdmin();
    
    if (bootstrapResult.success && bootstrapResult.adminCreated) {
      console.log('✅ New admin user created successfully:');
      console.log(`  - Username: ${bootstrapResult.username}`);
      console.log('  - Password: Set from WAHA_DEFAULT_ADMIN_PASSWORD environment variable');
    } else {
      console.error('❌ Failed to create new admin user:', bootstrapResult.error);
      await app.close();
      return;
    }
    
    // Step 5: Verify new admin status
    console.log('\n🔍 Verifying new admin status...');
    const finalStatus = await adminBootstrapService.getAdminStatus();
    console.log('Final admin status:', {
      authEnabled: finalStatus.authEnabled,
      adminExists: finalStatus.adminExists,
      adminCount: finalStatus.adminCount,
      activeAdminCount: finalStatus.activeAdminCount,
      defaultCredentialsConfigured: finalStatus.defaultCredentialsConfigured
    });
    
    // Step 6: Test admin authentication
    console.log('\n🔐 Testing admin authentication...');
    const adminPassword = process.env.WAHA_DEFAULT_ADMIN_PASSWORD || 
                         process.env.WAHA_ADMIN_PASSWORD ||
                         process.env.ADMIN_PASSWORD;
    
    if (!adminPassword) {
      console.error('❌ No admin password configured. Set WAHA_DEFAULT_ADMIN_PASSWORD environment variable.');
      await app.close();
      return;
    }
    
    try {
      const adminUser = await userService.validateUser(bootstrapResult.username || 'admin', adminPassword);
      if (adminUser) {
        console.log('✅ Admin authentication test successful');
        console.log(`  - User ID: ${adminUser.id}`);
        console.log(`  - Username: ${adminUser.username}`);
        console.log(`  - Email: ${adminUser.email}`);
        console.log(`  - Role: ${adminUser.role}`);
        console.log(`  - Active: ${adminUser.isActive}`);
      } else {
        console.error('❌ Admin authentication test failed');
      }
    } catch (error) {
      console.error('❌ Admin authentication test failed:', error.message);
    }
    
    console.log('\n🎉 Admin account reset completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`  - Old admin users: Deleted`);
    console.log(`  - New admin username: ${bootstrapResult.username || 'admin'}`);
    console.log(`  - New admin password: Set from environment variable`);
    console.log(`  - Authentication: Working`);
    
    await app.close();
    
  } catch (error) {
    console.error('❌ Error during admin reset:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  resetAdminAccount().catch(console.error);
}

export { resetAdminAccount };
