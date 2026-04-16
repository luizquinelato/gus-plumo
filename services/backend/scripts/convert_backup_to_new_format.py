#!/usr/bin/env python3
"""
Script para converter backups do formato antigo (flat) para o novo formato (por conta).

Uso:
    python services/backend/scripts/convert_backup_to_new_format.py
"""

import json
import os

def convert_tags_subtags(old_data):
    """
    Converte tags/subtags do formato antigo (flat) para o novo formato (por conta).
    
    Formato antigo:
    [
      {
        "name": "Alimentação",
        "icon": "Utensils",
        "subtags": [...]
      }
    ]
    
    Formato novo:
    [
      {
        "account_name": "Gustavo",
        "tags": [
          {
            "name": "Alimentação",
            "icon": "Utensils",
            "subtags": [...]
          }
        ]
      }
    ]
    """
    # Remove duplicatas de subtags
    for tag in old_data:
        subtags = tag.get("subtags", [])
        unique_subtags = []
        seen = set()
        
        for subtag in subtags:
            key = (subtag["name"], subtag["type"], subtag.get("icon", "HelpCircle"))
            if key not in seen:
                seen.add(key)
                unique_subtags.append(subtag)
        
        tag["subtags"] = unique_subtags
    
    # Cria estrutura para cada conta
    accounts = ["Gustavo", "Polezel", "Lurdes", "Acalento"]
    result = []
    
    for account_name in accounts:
        result.append({
            "account_name": account_name,
            "tags": old_data
        })
    
    return result

def convert_mappings(old_data):
    """
    Converte mapeamentos do formato antigo para o novo formato (por conta).
    
    Formato antigo:
    [
      {
        "descrição": "badoo",
        "tag": "Trabalho",
        "subtag": "Ferramenta & Conteúdo",
        "custom_description": "..."
      }
    ]
    
    Formato novo:
    [
      {
        "account_name": "Gustavo",
        "mappings": [
          {
            "original_description": "badoo",
            "tag": "Trabalho",
            "subtag": "Ferramenta & Conteúdo",
            "mapped_description": "..."
          }
        ]
      }
    ]
    """
    # Converte campos
    converted_mappings = []
    for mapping in old_data:
        new_mapping = {
            "original_description": mapping.get("descrição"),
            "tag": mapping["tag"],
            "subtag": mapping["subtag"]
        }
        
        if mapping.get("custom_description"):
            new_mapping["mapped_description"] = mapping["custom_description"]
        
        converted_mappings.append(new_mapping)
    
    # Cria estrutura para cada conta (apenas Gustavo tem mapeamentos)
    result = [
        {
            "account_name": "Gustavo",
            "mappings": converted_mappings
        },
        {
            "account_name": "Polezel",
            "mappings": []
        },
        {
            "account_name": "Lurdes",
            "mappings": []
        },
        {
            "account_name": "Acalento",
            "mappings": []
        }
    ]
    
    return result

def main():
    print("=" * 80)
    print("CONVERSOR DE BACKUPS PARA NOVO FORMATO")
    print("=" * 80)
    print()
    
    # Caminhos dos arquivos
    workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
    migrations_dir = os.path.join(workspace_root, 'services', 'backend', 'scripts', 'migrations')
    
    tags_backup = os.path.join(workspace_root, '0002_seed_data_inicial_tags_subtags-bkp.json')
    mappings_backup = os.path.join(workspace_root, '0002_seed_data_inicial_mapeamentos-bkp.json')
    
    tags_output = os.path.join(migrations_dir, '0002_seed_data_inicial_tags_subtags.json')
    mappings_output = os.path.join(migrations_dir, '0002_seed_data_inicial_mapeamentos.json')
    
    # Lê backups
    print(f"📖 Lendo backup de tags/subtags: {tags_backup}")
    with open(tags_backup, 'r', encoding='utf-8') as f:
        old_tags_data = json.load(f)
    print(f"   ✅ {len(old_tags_data)} tags lidas")
    
    print(f"📖 Lendo backup de mapeamentos: {mappings_backup}")
    with open(mappings_backup, 'r', encoding='utf-8') as f:
        old_mappings_data = json.load(f)
    print(f"   ✅ {len(old_mappings_data)} mapeamentos lidos")
    
    # Converte
    print("\n🔄 Convertendo para novo formato...")
    new_tags_data = convert_tags_subtags(old_tags_data)
    new_mappings_data = convert_mappings(old_mappings_data)
    
    # Salva
    print(f"\n💾 Salvando tags/subtags: {tags_output}")
    with open(tags_output, 'w', encoding='utf-8') as f:
        json.dump(new_tags_data, f, ensure_ascii=False, indent=2)
    print(f"   ✅ {len(new_tags_data)} contas salvas")
    
    print(f"💾 Salvando mapeamentos: {mappings_output}")
    with open(mappings_output, 'w', encoding='utf-8') as f:
        json.dump(new_mappings_data, f, ensure_ascii=False, indent=2)
    print(f"   ✅ {len(new_mappings_data)} contas salvas")
    
    print("\n✅ Conversão concluída com sucesso!")
    print("💡 Agora você pode rodar o migration 0002 novamente!")

if __name__ == '__main__':
    main()

