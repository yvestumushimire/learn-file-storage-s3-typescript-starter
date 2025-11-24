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
  let filePath = path.join(cfg.assetsRoot, fileName);
  await Bun.write(filePath, rawVideo);
  const aspectRatio = await getVideoAspectRatio(filePath);
  filePath = await processVideoForFastStart(filePath);
  const awsfileName = `${aspectRatio}/${fileName}`;
  const videoFile = Bun.file(filePath);
  const videoIdUuid = parse(videoId);
  const s3file = cfg.s3Client.file(awsfileName, {
    bucket: cfg.s3Bucket,
    // endpoint: `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/`,
  });
  await s3file.write(videoFile, { type: rawVideo.type });
  await videoFile.delete();
  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${awsfileName}`;

  updateVideo(cfg.db, video);
  return respondWithJSON(200, video);
}

function getFileExtensionFromMediaType(mediaType: string): string {
  const parts = mediaType.split("/");
  return parts.length === 2 ? parts[1] : "bin";
}

async function getVideoAspectRatio(filePath: string) {
  const process = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const outputText = await new Response(process.stdout).text();
  const errorText = await new Response(process.stderr).text();

  const exitCode = await process.exited;

  if (exitCode !== 0) {
    throw new Error(`ffprobe error: ${errorText}`);
  }

  const output = JSON.parse(outputText);
  if (!output.streams || output.streams.length === 0) {
    throw new Error("No video streams found");
  }

  const { width, height } = output.streams[0];

  return width === Math.floor(16 * (height / 9))
    ? "landscape"
    : height === Math.floor(16 * (width / 9))
      ? "portrait"
      : "other";
}

async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = inputFilePath + ".processed.mp4";
  const process = Bun.spawn(
    [
      "ffmpeg",
      "-i",
      inputFilePath,
      "-movflags",
      "faststart",
      "-map_metadata",
      "0",
      "-codec",
      "copy",
      "-f",
      "mp4",
      outputFilePath,
    ],
    {
      onExit(proc, exitCode, signalCode, error) {
        console.log("Done");
      },
    },
  );
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`ffmpeg process failed with exit code ${exitCode}`);
  }
  return outputFilePath;
}
