"""
Script para limpar arquivos de log antigos (com PID no nome).

Após a otimização da configuração de logging, este script remove
os arquivos de log antigos que continham PID no nome do arquivo.

Uso:
    python cleanup_old_logs.py
"""

import os
import glob
from pathlib import Path


def cleanup_old_logs():
    """Remove arquivos de log antigos com PID no nome."""
    
    # Diretório de logs
    logs_dir = Path(__file__).parent.parent / "logs"
    
    if not logs_dir.exists():
        print("❌ Diretório de logs não encontrado")
        return
    
    # Padrão de arquivos antigos: gus-expenses-backend-{PID}.log
    pattern = str(logs_dir / "gus-expenses-backend-*.log")
    old_log_files = glob.glob(pattern)
    
    # Filtra apenas arquivos com PID (número após o último hífen)
    files_to_remove = []
    for file_path in old_log_files:
        filename = os.path.basename(file_path)
        # Verifica se tem número após o último hífen (PID)
        # Exemplo: gus-expenses-backend-12345.log
        if filename.count('-') >= 3:  # gus-expenses-backend-{PID}
            parts = filename.replace('.log', '').split('-')
            if parts[-1].isdigit():
                files_to_remove.append(file_path)
    
    if not files_to_remove:
        print("✅ Nenhum arquivo de log antigo encontrado")
        return
    
    print(f"🗑️  Encontrados {len(files_to_remove)} arquivos de log antigos")
    print("\nArquivos a serem removidos:")
    for file_path in files_to_remove:
        file_size = os.path.getsize(file_path) / 1024  # KB
        print(f"  - {os.path.basename(file_path)} ({file_size:.1f} KB)")
    
    # Confirma remoção
    response = input("\n❓ Deseja remover esses arquivos? (s/N): ").strip().lower()
    
    if response == 's':
        removed_count = 0
        total_size = 0
        
        for file_path in files_to_remove:
            try:
                file_size = os.path.getsize(file_path)
                os.remove(file_path)
                removed_count += 1
                total_size += file_size
                print(f"  ✅ Removido: {os.path.basename(file_path)}")
            except Exception as e:
                print(f"  ❌ Erro ao remover {os.path.basename(file_path)}: {e}")
        
        total_size_mb = total_size / (1024 * 1024)
        print(f"\n🎉 {removed_count} arquivos removidos ({total_size_mb:.2f} MB liberados)")
    else:
        print("\n❌ Operação cancelada")


if __name__ == "__main__":
    cleanup_old_logs()

