import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import {
  COOKIES_REPO_ROOT,
  YoutubeCookiesService,
} from './cookies/youtube-cookies.service';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    YoutubeCookiesService,
    { provide: COOKIES_REPO_ROOT, useFactory: () => process.cwd() },
  ],
})
export class MediaModule {}
