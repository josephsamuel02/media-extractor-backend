import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class ExtractUrlDto {
  @ApiProperty({
    example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    description: 'Public social media post URL to resolve',
  })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url: string;
}
