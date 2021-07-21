import posthog, { PostHog } from 'posthog-js';
import SdkConfig from './SdkConfig';

interface IEvent {
    // The event name that will be used by PostHog.
    // TODO: standard format (camel case? snake? UpperCase?)
    eventName: string;

    // The properties of the event that will be stored in PostHog.
    properties: {}
}

export enum Anonymity {
    Anonymous,
    Pseudonymous
}

// If an event extends IPseudonymousEvent, the event contains pseudonymous data
// that won't be sent unless the user has explicitly consented to pseudonymous tracking.
// For example, hashed user IDs or room IDs.
export interface IPseudonymousEvent extends IEvent {}

// If an event extends IAnonymousEvent, the event strictly contains *only* anonymous data which
// may be sent without explicit user consent.
export interface IAnonymousEvent extends IEvent {}

export interface IRoomEvent extends IPseudonymousEvent {
    hashedRoomId: string
}

export interface IOnboardingLoginBegin extends IAnonymousEvent {
    key: "onboarding_login_begin",
}

const hashHex = async (input: string): Promise<string> => {
    const buf = new TextEncoder().encode(input);
    const digestBuf = await window.crypto.subtle.digest("sha-256", buf);
    return [...new Uint8Array(digestBuf)].map((b: number) => b.toString(16).padStart(2, "0")).join("");
};

const knownScreens = new Set([
    "register", "login", "forgot_password", "soft_logout", "new", "settings", "welcome", "home", "start", "directory",
    "start_sso", "start_cas", "groups", "complete_security", "post_registration", "room", "user", "group",
]);

export async function getRedactedCurrentLocation(origin: string, hash: string, pathname: string, anonymity: Anonymity) {
    // Redact PII from the current location.
    // If anonymous is true, redact entirely, if false, substitute it with a hash.
    // For known screens, assumes a URL structure of /<screen name>/might/be/pii
    if (origin.startsWith('file://')) {
        pathname = "/<redacted_file_scheme_url>/";
    }

    let [_, screen, ...parts] = hash.split("/");

    if (!knownScreens.has(screen)) {
        screen = "<redacted_screen_name>";
    }

    for (let i = 0; i < parts.length; i++) {
        parts[i] = anonymity === Anonymity.Anonymous ? `<redacted>` : await hashHex(parts[i]);
    }

    const hashStr = `${_}/${screen}/${parts.join("/")}`;
    return origin + pathname + hashStr;
}

export class PosthogAnalytics {
    private onlyTrackAnonymousEvents = false;
    private initialised = false;
    private posthog?: PostHog = null;
    private redactedCurrentLocation = null;

    private static _instance = null;

    public static instance(): PosthogAnalytics {
        if (!this._instance) {
            this._instance = new PosthogAnalytics(posthog);
        }
        return this._instance;
    }

    constructor(posthog: PostHog) {
        this.posthog = posthog;
    }

    public async init(onlyTrackAnonymousEvents: boolean) {
        if (Boolean(navigator.doNotTrack === "1")) {
            this.initialised = false;
            return;
        }
        this.onlyTrackAnonymousEvents = onlyTrackAnonymousEvents;

        const posthogConfig = SdkConfig.get()["posthog"];
        if (posthogConfig) {
            // Update the redacted current location before initialising posthog, as posthog.init triggers
            // an immediate pageview event which calls the sanitize_properties callback
            await this.updateRedactedCurrentLocation();

            this.posthog.init(posthogConfig.projectApiKey, {
                api_host: posthogConfig.apiHost,
                autocapture: false,
                mask_all_text: true,
                mask_all_element_attributes: true,
                sanitize_properties: this.sanitizeProperties.bind(this),
            });
            this.initialised = true;
        }
    }

    private async updateRedactedCurrentLocation() {
        // TODO only calculate this when the location changes as its expensive
        const { origin, hash, pathname } = window.location;
        this.redactedCurrentLocation = await getRedactedCurrentLocation(
            origin, hash, pathname, this.onlyTrackAnonymousEvents ? Anonymity.Anonymous : Anonymity.Pseudonymous);
    }

    private sanitizeProperties(properties: posthog.Properties, _: string): posthog.Properties {
        // Sanitize posthog's built in properties which leak PII e.g. url reporting
        // see utils.js _.info.properties in posthog-js

        // this.redactedCurrentLocation needs to have been updated prior to reaching this point as
        // updating it involves async, which this callback is not
        properties['$current_url'] = this.redactedCurrentLocation;

        if (this.onlyTrackAnonymousEvents) {
            // drop referrer information for anonymous users
            properties['$referrer'] = null;
            properties['$referring_domain'] = null;
            properties['$initial_referrer'] = null;
            properties['$initial_referring_domain'] = null;

            // drop device ID, which is a UUID persisted in local storage
            properties['$device_id'] = null;
        }

        return properties;
    }

    public async identifyUser(userId: string) {
        if (this.onlyTrackAnonymousEvents) return;
        this.posthog.identify(await hashHex(userId));
    }

    public isInitialised(): boolean {
        return this.initialised;
    }

    public setOnlyTrackAnonymousEvents(enabled: boolean) {
        this.onlyTrackAnonymousEvents = enabled;
    }

    private async capture(eventName: string, properties: posthog.Properties, anonymity: Anonymity) {
        if (!this.initialised) return;
        await this.updateRedactedCurrentLocation(anonymity);
        this.posthog.capture(eventName, properties);
    }

    public async trackPseudonymousEvent<E extends IPseudonymousEvent>(
        eventName: E["eventName"],
        properties: E["properties"],
    ) {
        if (this.onlyTrackAnonymousEvents) return;
        this.capture(eventName, properties, Anonymity.Pseudonyomous);
    }

    public async trackAnonymousEvent<E extends IAnonymousEvent>(
        eventName: E["eventName"],
        properties: E["properties"],
    ) {
        this.capture(eventName, properties, Anonymity.Anonymous);
    }

    public async trackRoomEvent<E extends IRoomEvent>(
        eventName: E["eventName"],
        roomId: string,
        properties: Omit<E["properties"], "roomId">,
    ) {
        const updatedProperties = {
            ...properties,
            hashedRoomId: roomId ? await hashHex(roomId) : null,
        };
        this.trackPseudonymousEvent(eventName, updatedProperties);
    }
}

export function getAnalytics(): PosthogAnalytics {
    return PosthogAnalytics.instance();
}
