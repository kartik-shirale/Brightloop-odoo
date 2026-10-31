/**
 * Manual constructor-based DI (backend-rules.md #1). No decorator metadata —
 * the tree is built once at boot, cheap and fully type-checked.
 */

import { getKvStore } from './config/redis.js';
import { EmailJsClient } from './core/mail/emailjs.js';
import { AuditRepository } from './modules/audit/audit.repository.js';
import { AuditService } from './modules/audit/audit.service.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { OtpService } from './modules/auth/otp.service.js';
import { SequencesRepository } from './modules/sequences/sequences.repository.js';
import { SequencesService } from './modules/sequences/sequences.service.js';
import { UsersRepository } from './modules/users/users.repository.js';
import { UsersService, type AuthSessionGateway } from './modules/users/users.service.js';

export interface AppServices {
  readonly authRepository: AuthRepository;
  readonly authService: AuthService;
  readonly otpService: OtpService;
  readonly usersRepository: UsersRepository;
  readonly usersService: UsersService;
  // --- module services: audit ---
  readonly auditService: AuditService;
  // --- module services: sequences ---
  readonly sequencesService: SequencesService;
  // --- end module services ---
}

/** Bridges users → auth without cross-module repository imports (rule #1). */
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

  // --- module wiring: audit ---
  const auditService = new AuditService(new AuditRepository());
  // --- module wiring: sequences ---
  const sequencesService = new SequencesService(new SequencesRepository());
  // --- end module wiring ---

  return { authRepository, authService, otpService, usersRepository, usersService, auditService, sequencesService };
}
