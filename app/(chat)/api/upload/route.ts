import { uploadFile } from '@uploadcare/upload-client';
import { v2 as cloudinary } from 'cloudinary';
import { NextRequest, NextResponse } from 'next/server';

// Constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml'
] as const;
const UPLOAD_TIMEOUT = 30000; // 30 seconds

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Uploadcare configuration
const uploadcareConfig = {
    publicKey: process.env.UPLOADCARE_PUBLIC_KEY!,
    secretKey: process.env.UPLOADCARE_SECRET_KEY!,
};

/**
 * API route for handling file uploads to Cloudinary or Uploadcare
 * 
 * @param request - NextRequest containing form data with file and service
 * @returns NextResponse with upload result or error
 */
export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const uploadService = (formData.get('service') as string) || 'cloudinary';

        // Validate file exists
        if (!file) {
            return NextResponse.json(
                { error: 'No file provided' },
                { status: 400 }
            );
        }

        // Validate file is actually a File object
        if (!(file instanceof File)) {
            return NextResponse.json(
                { error: 'Invalid file format' },
                { status: 400 }
            );
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json(
                { error: `File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit` },
                { status: 400 }
            );
        }

        // Validate file type
        if (!ALLOWED_IMAGE_TYPES.includes(file.type as any)) {
            return NextResponse.json(
                { error: 'File type not supported. Only images are allowed.' },
                { status: 400 }
            );
        }

        let uploadResult;

        if (uploadService === 'uploadcare') {
            // Validate Uploadcare configuration
            if (!process.env.UPLOADCARE_PUBLIC_KEY || !process.env.UPLOADCARE_SECRET_KEY) {
                return NextResponse.json(
                    { error: 'Uploadcare configuration missing' },
                    { status: 500 }
                );
            }

            // Upload to Uploadcare
            const uploadResult = await uploadFile(file, uploadcareConfig);

            return NextResponse.json({
                success: true,
                url: uploadResult.cdnUrl,
                service: 'uploadcare',
                fileId: uploadResult.uuid,
            });
        } else {
            // Validate Cloudinary configuration
            if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
                return NextResponse.json(
                    { error: 'Cloudinary configuration missing' },
                    { status: 500 }
                );
            }

            // Upload to Cloudinary (default)
            const buffer = await file.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            const dataURI = `data:${file.type};base64,${base64}`;

            uploadResult = await cloudinary.uploader.upload(dataURI, {
                folder: 'galaxy-chat',
                resource_type: 'auto',
                transformation: [
                    { quality: 'auto' },
                    { fetch_format: 'auto' }
                ]
            });

            return NextResponse.json({
                success: true,
                url: uploadResult.secure_url,
                service: 'cloudinary',
                publicId: uploadResult.public_id,
            });
        }
    } catch (error) {
        console.error('Upload error:', error);

        // Provide more specific error messages
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';

        return NextResponse.json(
            { error: `Upload failed: ${errorMessage}` },
            { status: 500 }
        );
    }
}
