import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Screen, Text } from '@/components';
import { captureService } from '@/services/capture/captureService';
import { useCaptureStore } from '@/state/captureStore';
import { colors, radius, spacing, touchTarget } from '@/theme';
import { pluralise } from '@/utils/format';

/**
 * The multi-page scanner.
 *
 * A guide frame plus a shot counter, rather than automatic edge detection: the
 * camera stays open between pages so a six-page discharge summary is six taps,
 * not six trips through the OS picker.
 *
 * When opened with `?retakePageId=...` it replaces that page instead of
 * appending, which is what the review screen's "Retake" button does.
 *
 * TODO(capture): add on-device edge detection and perspective correction
 * (react-native-document-scanner-plugin, or Vision/MLKit through a dev client)
 * so crooked phone shots straighten out before they reach Textract.
 */
export default function ScanScreen(): React.JSX.Element {
  const router = useRouter();
  const { retakePageId } = useLocalSearchParams<{ retakePageId?: string }>();
  const insets = useSafeAreaInsets();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);

  const pages = useCaptureStore((state) => state.pages);
  const addPages = useCaptureStore((state) => state.addPages);
  const replacePage = useCaptureStore((state) => state.replacePage);

  const isRetake = typeof retakePageId === 'string' && retakePageId.length > 0;
  const shotsThisSession = useRef(0);

  const handleCapture = async (): Promise<void> => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });
      if (!photo) return;

      const page = captureService.pageFromCamera(photo.uri, photo.width, photo.height);

      if (isRetake) {
        replacePage(retakePageId, page);
        router.back();
        return;
      }

      addPages([page]);
      shotsThisSession.current += 1;
    } finally {
      setCapturing(false);
    }
  };

  if (!permission) {
    return <Screen scrollable={false} testID="scan-loading" />;
  }

  if (!permission.granted) {
    return (
      <Screen
        testID="scan-permission"
        footer={
          <>
            <Button
              label="Allow camera access"
              onPress={() => void requestPermission()}
              testID="scan-request-permission"
            />
            <Button label="Go back" variant="ghost" onPress={() => router.back()} />
          </>
        }
      >
        <View style={styles.permissionBody}>
          <View style={styles.permissionIcon}>
            <Ionicons name="camera-outline" size={40} color={colors.primary} />
          </View>
          <Text variant="heading" align="center" style={styles.permissionTitle}>
            Camera access needed
          </Text>
          <Text variant="callout" tone="secondary" align="center">
            Ayunetz uses the camera only to photograph the documents you choose to add. Pictures
            stay on this phone until you upload them.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <View style={styles.container} testID="scan">
      <CameraView ref={cameraRef} style={styles.camera} facing="back" autofocus="on">
        <View style={[styles.overlay, { paddingTop: insets.top + spacing.lg }]}>
          <View style={styles.topBar}>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Close the scanner"
              hitSlop={12}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={26} color={colors.white} />
            </Pressable>

            <View style={styles.counter}>
              <Text variant="label" tone="inverse">
                {isRetake ? 'Retaking a page' : pluralise(pages.length, 'page')}
              </Text>
            </View>
          </View>

          <View style={styles.guide} pointerEvents="none">
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>

          <Text variant="caption" tone="inverse" align="center" style={styles.hint}>
            Line the page up inside the frame. Flat surface, good light, no shadows.
          </Text>

          <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
            <View style={styles.controlSide} />

            <Pressable
              onPress={() => void handleCapture()}
              disabled={capturing}
              accessibilityRole="button"
              accessibilityLabel={isRetake ? 'Retake this page' : 'Capture page'}
              accessibilityState={{ disabled: capturing }}
              testID="scan-shutter"
              style={({ pressed }) => [styles.shutter, pressed ? styles.shutterPressed : null]}
            >
              <View style={styles.shutterInner} />
            </Pressable>

            <View style={styles.controlSide}>
              {isRetake || pages.length === 0 ? null : (
                <Pressable
                  onPress={() => router.push('/capture/review')}
                  accessibilityRole="button"
                  accessibilityLabel={`Review ${pluralise(pages.length, 'page')}`}
                  testID="scan-done"
                  style={styles.doneButton}
                >
                  <Text variant="label" tone="inverse">
                    Done
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.white} />
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const GUIDE_BORDER = 3;

const styles = StyleSheet.create({
  camera: { flex: 1 },
  closeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.pill,
    height: touchTarget.min - 8,
    justifyContent: 'center',
    width: touchTarget.min - 8,
  },
  container: { backgroundColor: colors.black, flex: 1 },
  controlSide: { alignItems: 'center', justifyContent: 'center', width: 96 },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  corner: { borderColor: colors.white, height: 34, position: 'absolute', width: 34 },
  cornerBottomLeft: {
    borderBottomWidth: GUIDE_BORDER,
    borderLeftWidth: GUIDE_BORDER,
    bottom: 0,
    left: 0,
  },
  cornerBottomRight: {
    borderBottomWidth: GUIDE_BORDER,
    borderRightWidth: GUIDE_BORDER,
    bottom: 0,
    right: 0,
  },
  cornerTopLeft: { borderLeftWidth: GUIDE_BORDER, borderTopWidth: GUIDE_BORDER, left: 0, top: 0 },
  cornerTopRight: {
    borderRightWidth: GUIDE_BORDER,
    borderTopWidth: GUIDE_BORDER,
    right: 0,
    top: 0,
  },
  counter: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  doneButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: touchTarget.min - 8,
    paddingHorizontal: spacing.lg,
  },
  guide: { flex: 1, margin: spacing.xxl },
  hint: { marginBottom: spacing.lg, paddingHorizontal: spacing.xxl },
  overlay: { flex: 1, justifyContent: 'space-between' },
  shutter: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 4,
    height: 84,
    justifyContent: 'center',
    width: 84,
  },
  shutterInner: {
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    height: 64,
    width: 64,
  },
  shutterPressed: { opacity: 0.75 },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  permissionBody: { alignItems: 'center', paddingTop: spacing.giant },
  permissionIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 96,
    justifyContent: 'center',
    marginBottom: spacing.xl,
    width: 96,
  },
  permissionTitle: { marginBottom: spacing.sm },
});
