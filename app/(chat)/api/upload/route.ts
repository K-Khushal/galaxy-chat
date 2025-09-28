import { v2 as cloudinary } from "cloudinary";
import { type NextRequest, NextResponse } from "next/server";

// Constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * API route for handling file uploads to Cloudinary
 *
 * @param request - NextRequest containing form data with file
 * @returns NextResponse with upload result or error
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    // Validate file exists
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file is actually a File object
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Invalid file format" },
        { status: 400 },
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit` },
        { status: 400 },
      );
    }

    // Validate file type
    if (
      !ALLOWED_IMAGE_TYPES.includes(
        file.type as (typeof ALLOWED_IMAGE_TYPES)[number],
      )
    ) {
      return NextResponse.json(
        { error: "File type not supported. Only images are allowed." },
        { status: 400 },
      );
    }

    // Validate Cloudinary configuration
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return NextResponse.json(
        { error: "Cloudinary configuration missing" },
        { status: 500 },
      );
    }

    // Upload to Cloudinary
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const dataURI = `data:${file.type};base64,${base64}`;

    const uploadResult = await cloudinary.uploader.upload(dataURI, {
      folder: "galaxy-chat",
      resource_type: "auto",
      transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
      timeout: 60000, // 60 seconds timeout
    });

    if (!uploadResult.secure_url) {
      throw new Error("Upload failed: No URL returned from Cloudinary");
    }

    return NextResponse.json({
      success: true,
      url: uploadResult.secure_url,
      service: "cloudinary",
      publicId: uploadResult.public_id,
    });
  } catch (error) {
    console.error("Upload error:", error);

    // Provide more specific error messages
    const errorMessage =
      error instanceof Error ? error.message : "Upload failed";

    return NextResponse.json(
      { error: `Upload failed: ${errorMessage}` },
      { status: 500 },
    );
  }
}

/**
 * API route for deleting files from Cloudinary
 *
 * @param request - NextRequest containing publicId in the body
 * @returns NextResponse with deletion result or error
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { publicId } = body;

    // Validate publicId exists
    if (!publicId || typeof publicId !== "string") {
      return NextResponse.json(
        { error: "Public ID is required" },
        { status: 400 },
      );
    }

    // Validate Cloudinary configuration
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return NextResponse.json(
        { error: "Cloudinary configuration missing" },
        { status: 500 },
      );
    }

    // Delete from Cloudinary
    const deleteResult = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
    });

    // Cloudinary returns "ok" for successful deletion or "not found" if already deleted
    if (deleteResult.result !== "ok" && deleteResult.result !== "not found") {
      throw new Error(`Delete failed: ${deleteResult.result}`);
    }

    return NextResponse.json({
      success: true,
      message:
        deleteResult.result === "ok"
          ? "File deleted successfully"
          : "File was already deleted",
      publicId,
    });
  } catch (error) {
    console.error("Delete error:", error);

    // Provide more specific error messages
    const errorMessage =
      error instanceof Error ? error.message : "Delete failed";

    return NextResponse.json(
      { error: `Delete failed: ${errorMessage}` },
      { status: 500 },
    );
  }
}
