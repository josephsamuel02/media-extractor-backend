import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ExtractUrlDto } from './dto/extract-url.dto';
import { ExtractionResultDto } from './dto/extraction-result.dto';
import { MediaService } from './media.service';

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('extract')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resolve a public post URL into direct media links',
  })
  @ApiOkResponse({ type: ExtractionResultDto })
  @ApiBadRequestResponse({ description: "Invalid URL or unsupported platform" })
  @ApiUnprocessableEntityResponse({
    description: "Couldn't extract media (private/deleted/geo-blocked)",
  })
  extract(@Body() dto: ExtractUrlDto): Promise<ExtractionResultDto> {
    return this.mediaService.extract(dto.url);
  }
}
