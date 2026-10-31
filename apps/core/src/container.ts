/**
 * Manual constructor-based DI (backend-rules.md #1). The tree is built once at
 * boot, cheap and fully type-checked.
 *
 * Module blocks (backend plan section 5): every feature module owns exactly one
 * labelled block in each of the four regions below (imports, services
 * interface, wiring, returned services) and edits nothing else here. Blocks
 * are append-only. On a
 * merge conflict keep both sides. Wiring blocks are listed in dependency order,
 * so a module may use the gateways of the blocks above it.
 */

import { getKvStore } from './config/redis.js';
import { EmailJsClient } from './core/mail/emailjs.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { OtpService } from './modules/auth/otp.service.js';
import { UsersRepository } from './modules/users/users.repository.js';
import { UsersService, type AuthSessionGateway } from './modules/users/users.service.js';
// --- module imports: audit (F3) ---
import { AuditRepository } from './modules/audit/audit.repository.js';
import { AuditService } from './modules/audit/audit.service.js';
// --- end module imports: audit ---
// --- module imports: sequences (F4) ---
import { SequencesRepository } from './modules/sequences/sequences.repository.js';
import { SequencesService } from './modules/sequences/sequences.service.js';
// --- end module imports: sequences ---
// --- module imports: taxes (M1) ---
// --- end module imports: taxes ---
// --- module imports: payment-terms (M2) ---
// --- end module imports: payment-terms ---
// --- module imports: products (M3) ---
// --- end module imports: products ---
// --- module imports: staff (M4) ---
// --- end module imports: staff ---
// --- module imports: customers (M5) ---
// --- end module imports: customers ---
// --- module imports: plans (M6) ---
// --- end module imports: plans ---
// --- module imports: discounts (M7) ---
// --- end module imports: discounts ---
// --- module imports: quotation-templates (M8) ---
// --- end module imports: quotation-templates ---
// --- module imports: subscriptions (M9) ---
// --- end module imports: subscriptions ---
// --- module imports: invoices (M10) ---
// --- end module imports: invoices ---
// --- module imports: payments (M12) ---
// --- end module imports: payments ---
// --- module imports: billing-runs (M11) ---
// --- end module imports: billing-runs ---
// --- module imports: portal (M13) ---
// --- end module imports: portal ---
// --- module imports: reports (M14) ---
// --- end module imports: reports ---

export interface AppServices {
  readonly authRepository: AuthRepository;
  readonly authService: AuthService;
  readonly otpService: OtpService;
  readonly usersRepository: UsersRepository;
  readonly usersService: UsersService;
  // --- module services: audit (F3) ---
  readonly auditService: AuditService;
  // --- end module services: audit ---
  // --- module services: sequences (F4) ---
  readonly sequencesService: SequencesService;
  // --- end module services: sequences ---
  // --- module services: taxes (M1) ---
  // --- end module services: taxes ---
  // --- module services: payment-terms (M2) ---
  // --- end module services: payment-terms ---
  // --- module services: products (M3) ---
  // --- end module services: products ---
  // --- module services: staff (M4) ---
  // --- end module services: staff ---
  // --- module services: customers (M5) ---
  // --- end module services: customers ---
  // --- module services: plans (M6) ---
  // --- end module services: plans ---
  // --- module services: discounts (M7) ---
  // --- end module services: discounts ---
  // --- module services: quotation-templates (M8) ---
  // --- end module services: quotation-templates ---
  // --- module services: subscriptions (M9) ---
  // --- end module services: subscriptions ---
  // --- module services: invoices (M10) ---
  // --- end module services: invoices ---
  // --- module services: payments (M12) ---
  // --- end module services: payments ---
  // --- module services: billing-runs (M11) ---
  // --- end module services: billing-runs ---
  // --- module services: portal (M13) ---
  // --- end module services: portal ---
  // --- module services: reports (M14) ---
  // --- end module services: reports ---
}

/** Bridges users to auth without cross-module repository imports (rule #1). */
class AuthSessionGatewayAdapter implements AuthSessionGateway {
  constructor(private readonly authRepository: AuthRepository) {}

  async updatePasswordAndRevokeOthers(
    userId: number,
    passwordHash: string,
    keepSessionId: number,
  ): Promise<void> {
    await this.authRepository.changePassword(userId, passwordHash, keepSessionId);
  }

  async revokeSessionForUser(userId: number, sessionId: number): Promise<void> {
    const session = await this.authRepository.findSessionById(sessionId);
    if (session && session.userId === userId && session.revokedAt === null) {
      await this.authRepository.revokeSession(sessionId);
    }
  }
}

export function buildServices(): AppServices {
  const kv = getKvStore();
  const mailer = new EmailJsClient();

  const authRepository = new AuthRepository();
  const otpService = new OtpService(mailer, kv);
  const authService = new AuthService(authRepository, otpService, kv);

  const usersRepository = new UsersRepository();
  const usersService = new UsersService(usersRepository, new AuthSessionGatewayAdapter(authRepository));

  // --- module wiring: audit (F3) ---
  const auditService = new AuditService(new AuditRepository());
  // --- end module wiring: audit ---
  // --- module wiring: sequences (F4) ---
  const sequencesService = new SequencesService(new SequencesRepository());
  // --- end module wiring: sequences ---
  // --- module wiring: taxes (M1) ---
  // --- end module wiring: taxes ---
  // --- module wiring: payment-terms (M2) ---
  // --- end module wiring: payment-terms ---
  // --- module wiring: products (M3) ---
  // --- end module wiring: products ---
  // --- module wiring: staff (M4) ---
  // --- end module wiring: staff ---
  // --- module wiring: customers (M5) ---
  // --- end module wiring: customers ---
  // --- module wiring: plans (M6) ---
  // --- end module wiring: plans ---
  // --- module wiring: discounts (M7) ---
  // --- end module wiring: discounts ---
  // --- module wiring: quotation-templates (M8) ---
  // --- end module wiring: quotation-templates ---
  // --- module wiring: subscriptions (M9) ---
  // --- end module wiring: subscriptions ---
  // --- module wiring: invoices (M10) ---
  // --- end module wiring: invoices ---
  // --- module wiring: payments (M12) ---
  // --- end module wiring: payments ---
  // --- module wiring: billing-runs (M11) ---
  // --- end module wiring: billing-runs ---
  // --- module wiring: portal (M13) ---
  // --- end module wiring: portal ---
  // --- module wiring: reports (M14) ---
  // --- end module wiring: reports ---

  return {
    authRepository,
    authService,
    otpService,
    usersRepository,
    usersService,
    // --- module services return: audit (F3) ---
    auditService,
    // --- end module services return: audit ---
    // --- module services return: sequences (F4) ---
    sequencesService,
    // --- end module services return: sequences ---
    // --- module services return: taxes (M1) ---
    // --- end module services return: taxes ---
    // --- module services return: payment-terms (M2) ---
    // --- end module services return: payment-terms ---
    // --- module services return: products (M3) ---
    // --- end module services return: products ---
    // --- module services return: staff (M4) ---
    // --- end module services return: staff ---
    // --- module services return: customers (M5) ---
    // --- end module services return: customers ---
    // --- module services return: plans (M6) ---
    // --- end module services return: plans ---
    // --- module services return: discounts (M7) ---
    // --- end module services return: discounts ---
    // --- module services return: quotation-templates (M8) ---
    // --- end module services return: quotation-templates ---
    // --- module services return: subscriptions (M9) ---
    // --- end module services return: subscriptions ---
    // --- module services return: invoices (M10) ---
    // --- end module services return: invoices ---
    // --- module services return: payments (M12) ---
    // --- end module services return: payments ---
    // --- module services return: billing-runs (M11) ---
    // --- end module services return: billing-runs ---
    // --- module services return: portal (M13) ---
    // --- end module services return: portal ---
    // --- module services return: reports (M14) ---
    // --- end module services return: reports ---
  };
}
