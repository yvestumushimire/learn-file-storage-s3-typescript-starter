import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

// const videoThumbnails: Map<string, Thumbnail> = new Map();
const MAX_UPLOAD_SIZE = 10 << 20; // 10 MB

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  // const type = getMediaTypeFromBase64(video.thumbnailURL!);
  return new Response(video.thumbnailURL, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here

  const formData = await req.formData();
  const image = formData.get("thumbnail");
  if (!(image instanceof File)) {
    throw new BadRequestError("Invalid thumbnail file");
  }
  if (image.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file is too large");
  }
  const type = image.type;
  if (["image/png", "image/jpeg"].includes(type) === false) {
    throw new BadRequestError("Invalid thumbnail file type");
  }
  const imageData = await image.arrayBuffer();
  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError(
      "You do not have permission to upload thumbnail for this video",
    );
  }
  const extension = getFileExtensionFromMediaType(type);
  const fileName = randomBytes(32).toString("base64");
  const filePath = path.join(cfg.assetsRoot, `${fileName}.${extension}`);
  await Bun.write(filePath, imageData);
  video.thumbnailURL = `http://localhost:${cfg.port}/${filePath}`;
  updateVideo(cfg.db, video);
  return respondWithJSON(200, video);
}

function getFileExtensionFromMediaType(mediaType: string): string {
  const parts = mediaType.split("/");
  return parts.length === 2 ? parts[1] : "bin";
}
