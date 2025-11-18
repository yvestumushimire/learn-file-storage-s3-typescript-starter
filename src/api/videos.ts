import { respondWithJSON } from "./json";
import { parse } from "uuid";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import path from "node:path";
import {
  createVideo,
  deleteVideo,
  getVideo,
  getVideos,
  updateVideo,
} from "../db/videos";
import { UserForbiddenError, BadRequestError } from "./errors";
import { randomBytes } from "node:crypto";

const MAX_UPLOAD_SIZE = 1 << 30; // 1 GB

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId: string };
  const jwtToken = getBearerToken(req.headers);
  const userId = validateJWT(jwtToken, cfg.jwtSecret);
  const formData = await req.formData();
  const rawVideo = formData.get("video");
  if (!(rawVideo instanceof File)) {
    throw new BadRequestError("Invalid video file");
  }
  if (rawVideo.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("max video file size");
  }
  if (rawVideo.type !== "video/mp4") {
    throw new BadRequestError("Invalid video file");
  }
  const video = getVideo(cfg.db, videoId);
  if (video?.userID !== userId) {
    throw new UserForbiddenError("Permission denied");
  }
  const fileName = `${videoId}.${getFileExtensionFromMediaType(rawVideo.type)}`;
  const filePath = path.join(cfg.assetsRoot, fileName);
  await Bun.write(filePath, rawVideo);
  const videoFile = Bun.file(filePath);
  const videoIdUuid = parse(videoId);
  const s3file = cfg.s3Client.file(fileName, {
    bucket: cfg.s3Bucket,
    // endpoint: `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/`,
  });
  await s3file.write(videoFile, { type: rawVideo.type });
  await videoFile.delete();
  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileName}`;
  console.log(
    `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileName}`,
  );
  updateVideo(cfg.db, video);
  return respondWithJSON(200, video);
}

function getFileExtensionFromMediaType(mediaType: string): string {
  const parts = mediaType.split("/");
  return parts.length === 2 ? parts[1] : "bin";
}
