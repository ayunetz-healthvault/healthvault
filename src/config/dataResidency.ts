import { config, isBackendEnabled, isDemoBuild } from './env';

/**
 * Where a family's medical records actually live, in the build that is running.
 *
 * This module exists because the app once told users their documents were
 * "encrypted and stored in the Mumbai (ap-south-1) region" in a build that had
 * no cloud storage at all. That is the worst class of privacy bug: not a leak,
 * but a confident false statement about a leak that cannot happen yet.
 *
 * Every screen that describes storage reads from here, so there is exactly one
 * place to change when a tier becomes real — and no way for one screen to be
 * updated while another keeps making the old promise.
 *
 * The rule this file enforces: **describe the build you are, not the build you
 * intend to be.** Aspirational copy is a lie with a deployment date.
 */

/**
 * `demo` — a demonstration build. Every record on screen is fictional, and
 *   saying so is the whole point of the tier.
 * `on-device` — no backend reachable. Documents never leave the phone, and
 *   nothing is summarised remotely.
 * `local-backend` — a development backend on a laptop or a Codespace. Pages are
 *   sent to it, processed, and deleted; there is no durable server-side store.
 * `cloud` — the hosted platform. Only this tier may describe a region.
 */
export type DataResidencyTier = 'demo' | 'on-device' | 'local-backend' | 'cloud';

export interface DataResidencyCopy {
  /** One line, for a settings row. */
  readonly shortLabel: string;
  /** Where documents are kept. */
  readonly storage: string;
  /** What happens to a document when it is summarised. */
  readonly processing: string;
  /** The privacy card on the onboarding disclaimer. */
  readonly disclaimerBody: string;
  /**
   * True when this build has operational limitations a user must be told about
   * before trusting it with a real medical record. Phase 1 requires these to
   * stay visible in the app, not only in documentation.
   */
  readonly isPrototype: boolean;
}

/**
 * Which tier this build is running as.
 *
 * A cloud tier is claimed only when the app is talking to a backend over a URL
 * that is not a developer machine. `isBackendEnabled` already refuses plaintext
 * HTTP to anything but a loopback or private-LAN host, so an `https://` base
 * URL outside those ranges is the hosted platform.
 */
export const resolveDataResidencyTier = (): DataResidencyTier => {
  // Checked first: a demo build is never anything else, whatever else is set.
  if (isDemoBuild()) return 'demo';
  if (!isBackendEnabled()) return 'on-device';
  return config.api.baseUrl.startsWith('https://') ? 'cloud' : 'local-backend';
};

const COPY: Record<DataResidencyTier, (region: string) => DataResidencyCopy> = {
  demo: () => ({
    shortLabel: 'Demonstration build — fictional records',
    storage:
      'This is a demonstration. Every patient, document and summary you can see was written to show how the app works — none of it belongs to a real person. Nothing is uploaded, and there is no server behind this build.',
    processing:
      'Summaries here are pre-written examples, not readings of a real document. Adding your own document will produce an illustrative summary on this device and send nothing anywhere.',
    disclaimerBody:
      'This is a demonstration build. The records shown are fictional, nothing is uploaded, and anything you add stays on this device.',
    isPrototype: true,
  }),

  'on-device': () => ({
    shortLabel: 'This device only',
    storage:
      'Documents stay on this phone. There is no server in this build — nothing you add is uploaded, and deleting the app deletes the records with it.',
    processing:
      'Summaries in this build come from sample data, not from your documents. Nothing is sent anywhere to be read.',
    disclaimerBody:
      'Documents stay on this phone and are not uploaded anywhere. They are never sold, and never shared without your explicit action.',
    isPrototype: true,
  }),

  'local-backend': () => ({
    shortLabel: 'This device and a development server',
    storage:
      'Documents are kept on this phone. This is a development build: it sends pages to a processing server that you or your team are running, which deletes each page as soon as it has been read. No copy is stored on that server.',
    processing:
      'Before a document is summarised, personal details are removed from the text and only the redacted text is sent on. The original scan is never sent to the summarising service.',
    disclaimerBody:
      'This is a test build. Documents stay on this phone, and pages are sent to a development server only to be read and immediately deleted. They are never sold, and never shared without your explicit action.',
    isPrototype: true,
  }),

  cloud: (region) => ({
    shortLabel: `AWS ${region} (Mumbai)`,
    storage: `Documents are uploaded straight from this phone to encrypted storage in AWS ${region} (Mumbai), and are encrypted at rest with a key we manage in AWS KMS. Records stay in India.`,
    processing:
      'Summaries are produced by a service running in the same region, and only after personal details have been removed from the text. Your documents are never used to train anyone else’s model, and are never sold.',
    disclaimerBody: `Documents are encrypted and stored in the ${region} (Mumbai) region. They are never sold, and never shared without your explicit action.`,
    isPrototype: false,
  }),
};

/** The storage description for the running build. */
export const describeDataResidency = (): DataResidencyCopy =>
  COPY[resolveDataResidencyTier()](config.aws.region);
