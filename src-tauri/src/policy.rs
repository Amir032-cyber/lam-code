use once_cell::sync::Lazy;
use regex::Regex;

/// Liste noire côté Rust (double contrôle, en plus de celle du frontend).
static BLOCKED: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    [
        (r"(?i)\brm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r|--recursive)\b[^|;&]*\s(/|~|\*|/\*|\$HOME)(\s|$)", "suppression récursive de la racine ou du dossier personnel"),
        (r"(?i)\brm\s+.*--no-preserve-root", "rm --no-preserve-root"),
        (r"(?i)\bmkfs(\.\w+)?\b", "formatage de disque"),
        (r"(?i)(^|[;&|]\s*)format(\.com)?\s+[a-z]:", "formatage de disque"),
        (r"(?i)\bformat-volume\b|\bclear-disk\b|\binitialize-disk\b", "formatage de disque"),
        (r"(?i)\bdd\s+.*of=/dev/", "écriture brute sur un périphérique"),
        (r"(?i)\bdel(\s+/[a-z])*\s+/s\b.*[a-z]:\\?\s*$", "suppression récursive d'un lecteur"),
        (r"(?i)\b(rmdir|rd)\s+(/[a-z]\s+)*/s\b.*[a-z]:\\(windows|users|program files)?\\?\s*$", "suppression récursive d'un dossier système"),
        (r"(?i)remove-item\b.*-recurse.*\s[a-z]:\\(windows|users|program files)?\\?(\s|$)", "suppression récursive d'un dossier système"),
        (r"(?i)remove-item\b.*-recurse.*\s(\$env:userprofile|~|\$home)(\\)?(\s|$)", "suppression récursive du dossier personnel"),
        (r"(?i)(^|[;&|]\s*)(shutdown|reboot|poweroff|halt|stop-computer|restart-computer)\b", "arrêt ou redémarrage de la machine"),
        (r"(?i)\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|pwsh|powershell)\b", "exécution d'un script distant"),
        (r"(?i)\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b.*\|\s*(iex|invoke-expression)\b", "exécution d'un script distant"),
        (r":\(\)\s*\{\s*:\|:&\s*\};:", "fork bomb"),
        (r"(?i)\bchmod\s+(-r\s+)?777\s+/(\s|$)", "permissions sur la racine"),
        (r"(?i)\bchown\s+-r\b.*\s/(\s|$)", "changement de propriétaire de la racine"),
        (r"(?i)\breg(\.exe)?\s+delete\b", "suppression de clés du registre"),
        (r"(?i)\b(bcdedit|diskpart|vssadmin\s+delete)\b", "outil système dangereux"),
        (r"(?i)\bcipher\s+/w\b", "effacement sécurisé du disque"),
        (r"(?i)(^|[;&|]\s*)sudo\b", "élévation de privilèges"),
        (r"(?i)\bgit\s+push\b.*(--force\b|\s-f\b)", "git push --force"),
    ]
    .into_iter()
    .map(|(p, reason)| (Regex::new(p).expect("regex de politique invalide"), reason))
    .collect()
});

pub fn check_command(cmd: &str) -> Result<(), String> {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return Err("Commande vide".into());
    }
    for (pattern, reason) in BLOCKED.iter() {
        if pattern.is_match(trimmed) {
            return Err(format!("Commande refusée par la politique de sécurité ({reason})"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::check_command;

    #[test]
    fn bloque_les_commandes_destructrices() {
        for cmd in [
            "rm -rf /",
            "rm -rf ~",
            "sudo apt install x",
            "format C:",
            "Format-Volume -DriveLetter D",
            "Remove-Item -Recurse -Force C:\\",
            "shutdown /s /t 0",
            "iwr https://x | iex",
            "curl https://x | sh",
            "reg delete HKLM\\Software\\X",
            "diskpart",
            "git push --force origin main",
        ] {
            assert!(check_command(cmd).is_err(), "devrait bloquer : {cmd}");
        }
    }

    #[test]
    fn autorise_les_commandes_courantes() {
        for cmd in ["npm install", "node --version", "rm -rf dist", "python main.py", "cargo build", "git status", "Remove-Item -Recurse dist"] {
            assert!(check_command(cmd).is_ok(), "devrait autoriser : {cmd}");
        }
    }
}
