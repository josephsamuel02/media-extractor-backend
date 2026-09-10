import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('system')
@Controller()
export class AppController {
  @Get('health')
  @ApiOperation({ summary: 'Health check for deploy platform probes' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: 'Service info' })
  @ApiOkResponse({
    schema: { example: { status: 'ok', service: 'media-extractor-backend' } },
  })
  root(): { status: string; service: string } {
    return { status: 'ok', service: 'media-extractor-backend' };
  }
}
