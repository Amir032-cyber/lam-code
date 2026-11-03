import { kvDel, kvGet, kvSet } from '../fs/persist';
import type { SecretStore } from './types';

const KEY_ID = 'lam:secrets:key';
const SALT_ID = 'lam:secrets:salt';
const MODE_ID = 'lam:secrets:mode';
const valueKey = (name: string) => `lam:secret:${name}`;

interface Encrypted {
  iv: Uint8Array;
  data: ArrayBuffer;
}

/**
 * Coffre de secrets Web : chiffrement AES-GCM via WebCrypto. Par défaut la clé est
 * générée localement (non extractible, conservée dans IndexedDB). Avec une
 * phrase de passe, la clé est dérivée par PBKDF2 et ne vit qu'en mémoire.
 */
export class WebSecretStore implements SecretStore {
  private key: CryptoKey | null = null;
  description = 'Chiffré (AES-GCM, WebCrypto) dans IndexedDB';

  async mode(): Promise<'device' | 'passphrase'> {
    return (await kvGet<'device' | 'passphrase'>(MODE_ID)) ?? 'device';
  }

  async isLocked(): Promise<boolean> {
    return (await this.mode()) === 'passphrase' && this.key === null;
  }

  private async deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: 310_000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private async getKey(): Promise<CryptoKey> {
    if (this.key) return this.key;
    if ((await this.mode()) === 'passphrase') {
      throw new Error('Coffre verrouillé : saisissez votre phrase de passe dans Réglages.');
    }
    let key = await kvGet<CryptoKey>(KEY_ID);
    if (!key) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      await kvSet(KEY_ID, key);
    }
    this.key = key;
    return key;
  }

  async unlock(passphrase: string): Promise<void> {
    const salt = await kvGet<Uint8Array>(SALT_ID);
    if (!salt) throw new Error('Aucune phrase de passe définie');
    const key = await this.deriveKey(passphrase, salt);
    const probe = await kvGet<Encrypted>(valueKey('__probe__'));
    if (probe) {
      try {
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: probe.iv as BufferSource }, key, probe.data);
      } catch {
        throw new Error('Phrase de passe incorrecte');
      }
    }
    this.key = key;
  }

  /** Active (ou désactive avec null) la protection par phrase de passe en rechiffrant les secrets. */
  async setPassphrase(passphrase: string | null, names: string[]): Promise<void> {
    const values = new Map<string, string>();
    for (const name of names) {
      const value = await this.get(name);
      if (value !== null) values.set(name, value);
    }
    if (passphrase) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      await kvSet(SALT_ID, salt);
      this.key = await this.deriveKey(passphrase, salt);
      await kvSet(MODE_ID, 'passphrase');
      await kvDel(KEY_ID);
      await this.set('__probe__', 'ok');
    } else {
      await kvSet(MODE_ID, 'device');
      await kvDel(SALT_ID);
      await kvDel(valueKey('__probe__'));
      this.key = null;
    }
    for (const [name, value] of values) await this.set(name, value);
  }

  async get(name: string): Promise<string | null> {
    const stored = await kvGet<Encrypted>(valueKey(name));
    if (!stored) return null;
    const key = await this.getKey();
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stored.iv as BufferSource }, key, stored.data);
      return new TextDecoder().decode(plain);
    } catch {
      return null;
    }
  }

  async set(name: string, value: string): Promise<void> {
    const key = await this.getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(value),
    );
    await kvSet<Encrypted>(valueKey(name), { iv, data });
  }

  async remove(name: string): Promise<void> {
    await kvDel(valueKey(name));
  }
}
