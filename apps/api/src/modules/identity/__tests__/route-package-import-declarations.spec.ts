import { Controller, Get, Post } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { API_CONTROLLERS } from '../../../app.ts';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { assertEveryRouteGuarded } from '../http/route-coverage.ts';

// قالب الاستيراد وطلب التثبيت يطبّقان نفس التصريح الذي تطبّقه المعاينة: import:packages:business على النشاط وميزة orders.
const mounted = (name: string) => API_CONTROLLERS.filter((controller) => controller.name === name);

describe('package import route declarations', () => {
  it('mounts the commit controller and accepts its real declarations', () => {
    const commit = mounted('PackageImportCommitController');
    expect(commit).toHaveLength(1);
    expect(() =>
      assertEveryRouteGuarded([...commit, ...mounted('PackageImportPreviewController')]),
    ).not.toThrow();
  });

  it('refuses a commit-controller route that declares another permission', () => {
    @Controller('probe/package-import-permission')
    class PackageImportCommitController {
      @Get('template')
      @Require('manage:services:business', { business: 'businessId' })
      @RequiresFeature('orders')
      template(): string {
        return 'x';
      }
    }
    expect(() => assertEveryRouteGuarded([PackageImportCommitController])).toThrow(
      /PackageImportCommitController\.template \(package preview permission\/feature declaration\)/,
    );
  });

  it('refuses a commit-controller route that drops the orders feature or names another business parameter', () => {
    @Controller('probe/package-import-feature')
    class PackageImportCommitController {
      @Post('commits')
      @Require('import:packages:business', { business: 'businessId' })
      commit(): string {
        return 'x';
      }

      @Get('template')
      @Require('import:packages:business', { business: 'otherId' })
      @RequiresFeature('orders')
      template(): string {
        return 'x';
      }
    }
    expect(() => assertEveryRouteGuarded([PackageImportCommitController])).toThrow(
      /PackageImportCommitController\.commit .*PackageImportCommitController\.template /s,
    );
  });
});
