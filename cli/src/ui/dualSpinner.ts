/**
 * DualSpinner — two-line in-place terminal progress using ora.
 *
 * Line 1: primary progress (main pipeline)
 * Line 2: secondary progress (code-ref queue)
 *
 * When the primary succeeds, the secondary becomes a standalone spinner.
 * Falls back to line-by-line `logInfo` when `useProgress()` is false.
 */
import ora, { type Ora } from "ora";
import { logInfo, useProgress } from "./logger";

export class DualSpinner {
  private primary: Ora;
  private primaryText: string;
  private secondaryText: string;
  private primaryDone: boolean;
  private secondarySpinner: Ora | undefined;
  private readonly tty: boolean;

  constructor(primaryLabel: string) {
    this.primaryText = primaryLabel;
    this.secondaryText = "";
    this.primaryDone = false;
    this.secondarySpinner = undefined;
    this.tty = useProgress();

    if (this.tty) {
      this.primary = ora({ text: primaryLabel });
    } else {
      this.primary = ora({ text: primaryLabel, isSilent: true });
    }
  }

  start(): this {
    this.primary.start();
    return this;
  }

  updatePrimary(text: string): void {
    this.primaryText = text;
    if (!this.tty) {
      logInfo(text);
      return;
    }
    if (this.primaryDone) {
      return;
    }
    this.primary.text = this.secondaryText
      ? `${this.primaryText}\n  ${this.secondaryText}`
      : this.primaryText;
  }

  updateSecondary(text: string): void {
    this.secondaryText = text;
    if (!this.tty) {
      logInfo(text);
      return;
    }
    if (this.primaryDone) {
      // Primary already succeeded — update the standalone secondary spinner
      if (this.secondarySpinner) {
        this.secondarySpinner.text = text;
      }
      return;
    }
    this.primary.text = this.secondaryText
      ? `${this.primaryText}\n  ${this.secondaryText}`
      : this.primaryText;
  }

  succeedPrimary(message: string): void {
    this.primaryDone = true;
    if (this.tty) {
      this.primary.succeed(message);
      // If secondary is still active, start a standalone spinner for it
      if (this.secondaryText) {
        this.secondarySpinner = ora({ text: this.secondaryText });
        this.secondarySpinner.start();
      }
    } else {
      logInfo(message);
    }
  }

  succeedSecondary(message: string): void {
    if (this.tty) {
      if (this.secondarySpinner) {
        this.secondarySpinner.succeed(message);
        this.secondarySpinner = undefined;
      } else if (this.primaryDone) {
        // No secondary spinner was created (no secondary text was set)
        logInfo(message);
      } else {
        // Primary not yet succeeded — just update the combined text
        this.primary.succeed(message);
      }
    } else {
      logInfo(message);
    }
  }

  fail(message: string): void {
    if (this.tty) {
      this.primary.fail(message);
      if (this.secondarySpinner) {
        this.secondarySpinner.stop();
        this.secondarySpinner = undefined;
      }
    } else {
      logInfo(message);
    }
  }

  stop(): void {
    this.primary.stop();
    if (this.secondarySpinner) {
      this.secondarySpinner.stop();
      this.secondarySpinner = undefined;
    }
  }
}
