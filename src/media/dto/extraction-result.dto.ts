import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MediaFormatDto {
  @ApiProperty({ example: '720p' })
  quality: string;

  @ApiProperty({ example: 'mp4' })
  ext: string;

  @ApiProperty({ description: 'Direct CDN URL the client downloads from' })
  url: string;

  @ApiPropertyOptional({ example: 12345678 })
  approxFilesizeBytes?: number;

  @ApiPropertyOptional({
    description:
      'Headers (e.g. Referer/User-Agent) the client must send when downloading this URL',
    type: Object,
  })
  headers?: Record<string, string>;
}

export class ExtractionResultDto {
  @ApiProperty({
    example: 'twitter',
    description: 'Normalized platform slug derived from yt-dlp extractor_key',
  })
  platform: string;

  @ApiProperty({ enum: ['video', 'image', 'carousel', 'audio'] })
  type: 'video' | 'image' | 'carousel' | 'audio';

  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional()
  thumbnail?: string;

  @ApiPropertyOptional()
  durationSeconds?: number;

  @ApiProperty({ type: [MediaFormatDto] })
  formats: MediaFormatDto[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Direct image URLs for carousel / image posts',
  })
  images?: string[];
}
