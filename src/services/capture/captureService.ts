import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { config } from '@/config/env';
import type { CaptureSource, DocumentKind, DocumentPage } from '@/types/domain';
import { nowIso } from '@/utils/date';
import { createId } from '@/utils/id';

/**
 * Getting a medical report into the app.
 *
 * Four routes, because families produce documents in four different ways:
 *   - `scan`    in-app camera with a page guide, for multi-page reports
 *                (handled by the capture screen, which calls `pageFromCamera`)
 *   - `camera`  a single quick photo
 *   - `gallery` a photo a sibling already WhatsApp'd over
 *   - `file`    a PDF emailed by the lab
 */

export type CaptureOutcome =
  | { status: 'success'; pages: DocumentPage[] }
  | { status: 'cancelled' }
  | { status: 'permission_denied'; permission: 'camera' | 'library' }
  | { status: 'too_large'; fileName: string; sizeBytes: number };

const PDF_MIME = 'application/pdf';

const kindFor = (mimeType: string | undefined, uri: string): DocumentKind => {
  if (mimeType === PDF_MIME) return 'pdf';
  if (uri.toLowerCase().endsWith('.pdf')) return 'pdf';
  return 'image';
};

const nameFromUri = (uri: string, fallback: string): string => {
  const last = uri.split('/').pop();
  return last && last.length > 0 ? decodeURIComponent(last) : fallback;
};

/** Builds a `DocumentPage` from anything that has a URI. Exported for tests. */
export const buildPage = (input: {
  uri: string;
  source: CaptureSource;
  fileName?: string | undefined;
  mimeType?: string | undefined;
  sizeBytes?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
}): DocumentPage => ({
  id: createId('pag'),
  uri: input.uri,
  kind: kindFor(input.mimeType, input.uri),
  source: input.source,
  fileName: input.fileName ?? nameFromUri(input.uri, `page-${Date.now()}.jpg`),
  sizeBytes: input.sizeBytes ?? 0,
  width: input.width ?? null,
  height: input.height ?? null,
  capturedAt: nowIso(),
});

/** Rejects anything past the presigned-upload ceiling before the user waits on it. */
export const exceedsSizeLimit = (sizeBytes: number): boolean =>
  sizeBytes > config.upload.maxUploadBytes;

export const captureService = {
  /** Wraps a photo taken by the in-app scanner camera. */
  pageFromCamera(uri: string, width?: number, height?: number): DocumentPage {
    return buildPage({ uri, source: 'scan', width, height });
  },

  /** Single photo via the OS camera UI. */
  async takePhoto(): Promise<CaptureOutcome> {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: 'permission_denied', permission: 'camera' };

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      // Cropping a lab report usually loses a column — let the user keep the frame.
      allowsEditing: false,
      exif: false,
    });
    if (result.canceled || !result.assets?.length) return { status: 'cancelled' };

    const pages = result.assets.map((asset) =>
      buildPage({
        uri: asset.uri,
        source: 'camera',
        fileName: asset.fileName ?? undefined,
        mimeType: asset.mimeType ?? undefined,
        sizeBytes: asset.fileSize ?? undefined,
        width: asset.width,
        height: asset.height,
      }),
    );
    return { status: 'success', pages };
  },

  /** Photos already on the phone. Multi-select, because reports run to pages. */
  async pickFromGallery(): Promise<CaptureOutcome> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { status: 'permission_denied', permission: 'library' };

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      selectionLimit: 20,
      quality: 0.8,
      exif: false,
    });
    if (result.canceled || !result.assets?.length) return { status: 'cancelled' };

    for (const asset of result.assets) {
      if (exceedsSizeLimit(asset.fileSize ?? 0)) {
        return {
          status: 'too_large',
          fileName: asset.fileName ?? 'image',
          sizeBytes: asset.fileSize ?? 0,
        };
      }
    }

    const pages = result.assets.map((asset) =>
      buildPage({
        uri: asset.uri,
        source: 'gallery',
        fileName: asset.fileName ?? undefined,
        mimeType: asset.mimeType ?? undefined,
        sizeBytes: asset.fileSize ?? undefined,
        width: asset.width,
        height: asset.height,
      }),
    );
    return { status: 'success', pages };
  },

  /** PDFs and images from Files / Drive / email attachments. */
  async pickFile(): Promise<CaptureOutcome> {
    const result = await DocumentPicker.getDocumentAsync({
      type: [PDF_MIME, 'image/*'],
      multiple: true,
      // Copying into the cache means the URI survives after the picker closes.
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return { status: 'cancelled' };

    for (const asset of result.assets) {
      if (exceedsSizeLimit(asset.size ?? 0)) {
        return { status: 'too_large', fileName: asset.name, sizeBytes: asset.size ?? 0 };
      }
    }

    const pages = result.assets.map((asset) =>
      buildPage({
        uri: asset.uri,
        source: 'file',
        fileName: asset.name,
        mimeType: asset.mimeType ?? undefined,
        sizeBytes: asset.size ?? undefined,
      }),
    );
    return { status: 'success', pages };
  },
};
