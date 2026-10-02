#!/usr/bin/env python3
"""
Migration 0002: Seed Data Inicial
Descrição: Insere dados iniciais no banco de dados
Autor: Gus Expenses Platform
Data: 2025-12-29

Esta migration cria:
- Tenant 'Gus Expenses' (ID 1)
- Usuário admin (gustavoquinelato@gmail.com / senha: Gus@2026!)
- Permissões ADMIN (acesso total a todos os recursos)
- Bancos brasileiros (catálogo COMPE)
- Uma conta bancária mínima (BTG Pactual — Gustavo) para login/seleção de conta
- Cores padrão do Plumo e system_settings (ícones)

Cadastros (contas extras, cartões, compartilhamentos, tags, mapeamentos, templates)
são sincronizados entre PROD e DEV via scripts/sync_cadastro_prod_dev.py
"""

import os
import sys
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
import hashlib

# Adiciona o backend service ao path
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, backend_path)

# Import color calculation service
from app.services.color_calculation_service import ColorCalculationService

def get_database_connection():
    """Obtém conexão com o banco de dados usando configuração do backend."""
    try:
        from dotenv import load_dotenv
        load_dotenv()

        database_url = os.getenv('DATABASE_URL', 'postgresql://plumo:plumo@localhost:5432/plumo')

        # Parse DATABASE_URL
        # Format: postgresql://user:password@host:port/database
        import re
        match = re.match(r'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)', database_url)
        if not match:
            raise ValueError(f"Invalid DATABASE_URL format: {database_url}")

        user, password, host, port, database = match.groups()

        connection = psycopg2.connect(
            host=host,
            port=int(port),
            database=database,
            user=user,
            password=password,
            cursor_factory=RealDictCursor
        )
        connection.autocommit = False
        return connection
    except Exception as e:
        print(f"❌ Falha ao conectar ao banco de dados: {e}")
        sys.exit(1)

def hash_password(password: str) -> str:
    """Gera hash SHA256 da senha."""
    return hashlib.sha256(password.encode()).hexdigest()

def calculate_luminance(hex_color: str) -> float:
    """Calculate WCAG relative luminance"""
    hex_color = hex_color.lstrip('#')
    r, g, b = tuple(int(hex_color[i:i+2], 16) / 255.0 for i in (0, 2, 4))

    def linearize(c):
        return (c/12.92) if c <= 0.03928 else ((c+0.055)/1.055) ** 2.4

    return 0.2126*linearize(r) + 0.7152*linearize(g) + 0.0722*linearize(b)

def calculate_contrast_ratio(color1: str, color2: str) -> float:
    """Calculate WCAG contrast ratio between two colors"""
    lum1 = calculate_luminance(color1)
    lum2 = calculate_luminance(color2)
    lighter = max(lum1, lum2)
    darker = min(lum1, lum2)
    return (lighter + 0.05) / (darker + 0.05)

def pick_on_color(bg_color: str) -> str:
    """Pick white or black text color based on background"""
    contrast_white = calculate_contrast_ratio(bg_color, '#FFFFFF')
    contrast_black = calculate_contrast_ratio(bg_color, '#000000')
    return '#FFFFFF' if contrast_white > contrast_black else '#000000'

def darken_color(hex_color: str, factor: float) -> str:
    """Darken a color by a factor"""
    hex_color = hex_color.lstrip('#')
    r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

    r = max(0, int(r * (1 - factor)))
    g = max(0, int(g * (1 - factor)))
    b = max(0, int(b * (1 - factor)))

    return f"#{r:02x}{g:02x}{b:02x}".upper()

def apply(connection):
    """Aplica a migration de seed data."""
    print("🚀 Aplicando Migration 0002: Seed Data Inicial")

    cursor = connection.cursor()

    try:
        # 1. Insere tenant 'Gus Expenses'
        cursor.execute("""
            INSERT INTO tenants (id, name, website, assets_folder, tier, active, created_at, last_updated_at)
            VALUES (1, 'Gus Expenses', NULL, 'gus-expenses', 'premium', TRUE, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING;
        """)
        
        # Reseta sequence do tenant para começar do 2
        cursor.execute("SELECT setval('tenants_id_seq', 1, true);")

        print("✅ Tenant criado")
        print("📋 Inserindo usuário admin...")

        # 2. Insere usuário admin
        password_hash = hash_password('Gus@2026!')
        cursor.execute("""
            INSERT INTO users (
                tenant_id, email, first_name, last_name, role, is_admin,
                auth_provider, password_hash, theme_mode, active,
                created_at, last_updated_at
            )
            VALUES (
                1, 'gustavoquinelato@gmail.com', 'Gustavo', 'Quinelato', 'admin', TRUE,
                'local', %s, 'light', TRUE,
                NOW(), NOW()
            )
            RETURNING id;
        """, (password_hash,))
        
        user_result = cursor.fetchone()
        user_id = user_result['id']

        print(f"✅ Usuário admin criado (ID: {user_id})")

        print("📋 Inserindo permissões ADMIN...")

        # 3. Insere permissões ADMIN (acesso total)
        recursos = [
            'tags', 'subtags', 'credit_cards', 'credit_card_invoices', 'bank_statements',
            'users', 'system_settings', 'import', 'export', 'dashboard'
        ]
        acoes = ['create', 'read', 'update', 'delete']

        # Permissões para Gustavo
        for recurso in recursos:
            for acao in acoes:
                cursor.execute("""
                    INSERT INTO users_permissions (
                        tenant_id, user_id, resource, action, granted, active,
                        created_by, created_at, last_updated_at
                    )
                    VALUES (1, %s, %s, %s, TRUE, TRUE, %s, NOW(), NOW());
                """, (user_id, recurso, acao, user_id))
        print(f"✅ {len(recursos) * len(acoes)} permissões criadas para Gustavo")

        # 4. Insere bancos brasileiros
        print("📋 Inserindo bancos brasileiros...")
        banks_data = [
            ('001', 'Banco do Brasil', 'Banco do Brasil S.A.', '00000000'),
            ('033', 'Santander', 'Banco Santander (Brasil) S.A.', '90400888'),
            ('104', 'Caixa Econômica Federal', 'Caixa Econômica Federal', '00360305'),
            ('237', 'Bradesco', 'Banco Bradesco S.A.', '60746948'),
            ('260', 'Nubank', 'Nu Pagamentos S.A.', '18236120'),
            ('341', 'Itaú', 'Itaú Unibanco S.A.', '60701190'),
            ('077', 'Banco Inter', 'Banco Inter S.A.', '00416968'),
            ('212', 'Banco Original', 'Banco Original S.A.', '92894922'),
            ('208', 'BTG Pactual', 'Banco BTG Pactual S.A.', '30306294'),
            ('336', 'C6 Bank', 'Banco C6 S.A.', '31872495'),
            ('290', 'PagSeguro', 'PagSeguro Internet S.A.', '08561701'),
            ('323', 'Mercado Pago', 'Mercado Pago', '10573521'),
            ('380', 'PicPay', 'PicPay Servicos S.A.', '22896431'),
            ('102', 'XP Investimentos', 'XP Investimentos S.A.', '02332886'),
            ('197', 'Stone', 'Stone Pagamentos S.A.', '16501555'),
            ('389', 'Banco Mercantil', 'Banco Mercantil do Brasil S.A.', '17184037'),
            ('422', 'Banco Safra', 'Banco Safra S.A.', '58160789'),
            ('070', 'BRB', 'BRB - Banco de Brasília S.A.', '00000208'),
            ('041', 'Banrisul', 'Banco do Estado do Rio Grande do Sul S.A.', '92702067'),
            ('756', 'Bancoob', 'Banco Cooperativo do Brasil S.A.', '02038232'),
            ('748', 'Sicredi', 'Banco Cooperativo Sicredi S.A.', '01181521'),
            ('655', 'Neon', 'Banco Neon S.A.', '20855875'),
            ('637', 'Sofisa', 'Banco Sofisa S.A.', '60889128'),
            ('633', 'Rendimento', 'Banco Rendimento S.A.', '68900810'),
            ('218', 'BS2', 'Banco BS2 S.A.', '71027866'),
            ('623', 'Pan', 'Banco Pan S.A.', '59285411'),
            ('654', 'Banco Digimais', 'Banco Digimais S.A.', '92874270'),
            ('735', 'Banco Neon', 'Banco Neon S.A.', '20855875'),
            ('403', 'Cora', 'Cora Sociedade de Crédito Direto S.A.', '37880206'),
            ('084', 'Uniprime Norte do Paraná', 'Uniprime Norte do Paraná', '02398976'),
            ('097', 'Credisis', 'Credisis Central de Cooperativas de Crédito Ltda.', '05463212'),
            ('085', 'Ailos', 'Cooperativa Central de Crédito - Ailos', '05463212'),
            ('136', 'Unicred', 'Unicred do Brasil', '00315557'),
            ('121', 'Banco Agibank', 'Banco Agibank S.A.', '10664513'),
            ('739', 'Banco Cetelem', 'Banco Cetelem S.A.', '00558456'),
            ('743', 'Banco Semear', 'Banco Semear S.A.', '00795423'),
            ('100', 'Planner', 'Planner Corretora de Valores S.A.', '00806535'),
            ('096', 'Banco B3', 'Banco B3 S.A.', '00997185'),
            ('301', 'BPP', 'BPP Instituição de Pagamento S.A.', '15173776'),
            ('364', 'Gerencianet', 'Gerencianet Pagamentos do Brasil Ltda.', '09089356'),
            ('999', 'Banco Fictício', 'Banco Fictício para Testes', '99999999'),
        ]

        for code, name, full_name, ispb in banks_data:
            cursor.execute("""
                INSERT INTO banks (code, name, full_name, ispb, tenant_id, active, created_at, last_updated_at)
                VALUES (%s, %s, %s, %s, 1, TRUE, NOW(), NOW());
            """, (code, name, full_name, ispb))

        print(f"✅ {len(banks_data)} bancos inseridos")

        # 5. Conta mínima para login / seleção de conta (demais contas vêm do sync PROD→DEV)
        print("📋 Inserindo conta bancária mínima...")

        cursor.execute("SELECT id FROM banks WHERE code = '208';")
        btg_bank_id = cursor.fetchone()['id']

        cursor.execute("""
            INSERT INTO accounts (
                user_id, name, description, account_type,
                bank_id, agency, account_number,
                tenant_id, created_by, created_at, last_updated_at, active
            )
            VALUES (
                %s, 'Gustavo', 'Conta corrente principal',
                'corrente', %s, '0020', 3046547,
                1, %s, NOW(), NOW(), TRUE
            )
            RETURNING id;
        """, (user_id, btg_bank_id, user_id))
        account_id = cursor.fetchone()['id']
        print(f"✅ Conta Gustavo - BTG Pactual criada (ID: {account_id})")

        # 6. Insere cores padrão do Plumo (light e dark) com cálculo dinâmico
        print("📋 Inserindo cores padrão do Plumo com cálculo dinâmico...")

        # Inicializa o serviço de cálculo de cores
        color_service = ColorCalculationService()

        # Define as cores base para cada modo
        # DEFAULT: Blue, Green, Teal Dark, Purple Gray, Deep Purple
        # CUSTOM: Sunset palette (warm tones with contrast)
        color_configs = [
            {
                'mode': 'default',
                'theme': 'light',
                # Blue, Green, Teal Dark, Purple Gray, Deep Purple
                'colors': ['#297BFF', '#0CC02A', '#005F61', '#6F74B8', '#220080']
            },
            {
                'mode': 'default',
                'theme': 'dark',
                # Same colors for dark mode
                'colors': ['#297BFF', '#0CC02A', '#005F61', '#6F74B8', '#220080']
            },
            {
                'mode': 'custom',
                'theme': 'light',
                # Sunset: Coral, Amber, Magenta, Cyan, Slate
                'colors': ['#E63946', '#F4A261', '#9D4EDD', '#00B4D8', '#2D3748']
            },
            {
                'mode': 'custom',
                'theme': 'dark',
                # Sunset (brighter for dark): Rose, Gold, Violet, Aqua, Gray
                'colors': ['#FF6B6B', '#FFD93D', '#C77DFF', '#48CAE4', '#4A5568']
            }
        ]

        # Insere cada configuração de cor
        for config in color_configs:
            mode = config['mode']
            theme = config['theme']
            colors = config['colors']

            # Calcula on-colors para cada cor base
            on_colors = [color_service.pick_on_color(color) for color in colors]

            # Calcula on-colors para gradientes
            on_gradient_1_2 = color_service.pick_gradient_on_color(colors[0], colors[1])
            on_gradient_2_3 = color_service.pick_gradient_on_color(colors[1], colors[2])
            on_gradient_3_4 = color_service.pick_gradient_on_color(colors[2], colors[3])
            on_gradient_4_5 = color_service.pick_gradient_on_color(colors[3], colors[4])
            on_gradient_5_1 = color_service.pick_gradient_on_color(colors[4], colors[0])

            cursor.execute("""
                INSERT INTO tenants_colors (
                    tenant_id, color_schema_mode, accessibility_level, theme_mode,
                    color1, color2, color3, color4, color5,
                    on_color1, on_color2, on_color3, on_color4, on_color5,
                    on_gradient_1_2, on_gradient_2_3, on_gradient_3_4, on_gradient_4_5, on_gradient_5_1,
                    active, created_at, last_updated_at
                )
                VALUES (
                    1, %s, 'regular', %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    TRUE, NOW(), NOW()
                );
            """, (
                mode, theme,
                colors[0], colors[1], colors[2], colors[3], colors[4],
                on_colors[0], on_colors[1], on_colors[2], on_colors[3], on_colors[4],
                on_gradient_1_2, on_gradient_2_3, on_gradient_3_4, on_gradient_4_5, on_gradient_5_1
            ))

            print(f"✅ Cores {mode}/{theme} criadas com cálculo dinâmico")
            print(f"   color4={colors[3]} → on_color4={on_colors[3]}")

        # 8.1. Cria variantes AA e AAA para acessibilidade
        print("📋 Criando variantes de acessibilidade (AA e AAA)...")

        # Busca todas as configurações de cores existentes
        cursor.execute("""
            SELECT id, tenant_id, color_schema_mode, theme_mode, accessibility_level,
                   color1, color2, color3, color4, color5,
                   on_color1, on_color2, on_color3, on_color4, on_color5,
                   on_gradient_1_2, on_gradient_2_3, on_gradient_3_4, on_gradient_4_5, on_gradient_5_1
            FROM tenants_colors
            WHERE active = true AND accessibility_level = 'regular'
            ORDER BY tenant_id, color_schema_mode, theme_mode
        """)

        existing_colors = cursor.fetchall()

        # Para cada configuração existente, cria variantes AA e AAA
        for row in existing_colors:
            tenant_id = row['tenant_id']
            mode = row['color_schema_mode']
            theme = row['theme_mode']

            # Cores base
            base_colors = {
                'color1': row['color1'],
                'color2': row['color2'],
                'color3': row['color3'],
                'color4': row['color4'],
                'color5': row['color5'],
            }

            # Cria variante AA (escurecimento de 5%)
            aa_colors = {}
            for i in range(1, 6):
                color_key = f'color{i}'
                aa_colors[color_key] = darken_color(base_colors[color_key], 0.05)

            # Calcula on-colors para AA
            aa_on_colors = {}
            for i in range(1, 6):
                color_key = f'color{i}'
                aa_on_colors[f'on_color{i}'] = pick_on_color(aa_colors[color_key])

            # Calcula gradient on-colors para AA
            aa_gradient_colors = {}
            pairs = [(1, 2), (2, 3), (3, 4), (4, 5), (5, 1)]
            for i, j in pairs:
                on_i = pick_on_color(aa_colors[f'color{i}'])
                on_j = pick_on_color(aa_colors[f'color{j}'])
                aa_gradient_colors[f'on_gradient_{i}_{j}'] = '#FFFFFF' if (on_i == '#FFFFFF' or on_j == '#FFFFFF') else '#000000'

            # Insere variante AA
            cursor.execute("""
                INSERT INTO tenants_colors (
                    tenant_id, color_schema_mode, theme_mode, accessibility_level,
                    color1, color2, color3, color4, color5,
                    on_color1, on_color2, on_color3, on_color4, on_color5,
                    on_gradient_1_2, on_gradient_2_3, on_gradient_3_4, on_gradient_4_5, on_gradient_5_1,
                    active, created_at, last_updated_at
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    true, NOW(), NOW()
                )
            """, (
                tenant_id, mode, theme, 'AA',
                aa_colors['color1'], aa_colors['color2'], aa_colors['color3'], aa_colors['color4'], aa_colors['color5'],
                aa_on_colors['on_color1'], aa_on_colors['on_color2'], aa_on_colors['on_color3'], aa_on_colors['on_color4'], aa_on_colors['on_color5'],
                aa_gradient_colors['on_gradient_1_2'], aa_gradient_colors['on_gradient_2_3'], aa_gradient_colors['on_gradient_3_4'], aa_gradient_colors['on_gradient_4_5'], aa_gradient_colors['on_gradient_5_1']
            ))

            # Cria variante AAA (escurecimento de 10%)
            aaa_colors = {}
            for i in range(1, 6):
                color_key = f'color{i}'
                aaa_colors[color_key] = darken_color(base_colors[color_key], 0.1)

            # Calcula on-colors para AAA
            aaa_on_colors = {}
            for i in range(1, 6):
                color_key = f'color{i}'
                aaa_on_colors[f'on_color{i}'] = pick_on_color(aaa_colors[color_key])

            # Calcula gradient on-colors para AAA
            aaa_gradient_colors = {}
            for i, j in pairs:
                on_i = pick_on_color(aaa_colors[f'color{i}'])
                on_j = pick_on_color(aaa_colors[f'color{j}'])
                aaa_gradient_colors[f'on_gradient_{i}_{j}'] = '#FFFFFF' if (on_i == '#FFFFFF' or on_j == '#FFFFFF') else '#000000'

            # Insere variante AAA
            cursor.execute("""
                INSERT INTO tenants_colors (
                    tenant_id, color_schema_mode, theme_mode, accessibility_level,
                    color1, color2, color3, color4, color5,
                    on_color1, on_color2, on_color3, on_color4, on_color5,
                    on_gradient_1_2, on_gradient_2_3, on_gradient_3_4, on_gradient_4_5, on_gradient_5_1,
                    active, created_at, last_updated_at
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    true, NOW(), NOW()
                )
            """, (
                tenant_id, mode, theme, 'AAA',
                aaa_colors['color1'], aaa_colors['color2'], aaa_colors['color3'], aaa_colors['color4'], aaa_colors['color5'],
                aaa_on_colors['on_color1'], aaa_on_colors['on_color2'], aaa_on_colors['on_color3'], aaa_on_colors['on_color4'], aaa_on_colors['on_color5'],
                aaa_gradient_colors['on_gradient_1_2'], aaa_gradient_colors['on_gradient_2_3'], aaa_gradient_colors['on_gradient_3_4'], aaa_gradient_colors['on_gradient_4_5'], aaa_gradient_colors['on_gradient_5_1']
            ))

        # Conta total de configurações de cores
        cursor.execute("SELECT COUNT(*) as total FROM tenants_colors WHERE active = true")
        total_colors = cursor.fetchone()['total']
        print(f"✅ Variantes de acessibilidade criadas. Total de configurações: {total_colors}")

        # 8.2. Insere lista de ícones disponíveis em system_settings
        print("📋 Inserindo lista de ícones disponíveis...")

        # Lista de ícones do lucide-react mais comuns para categorias financeiras
        available_icons = [
            # Básicos
            "Tag", "Tags", "Folder", "FolderOpen", "Bookmark", "Star", "Heart",
            # Compras e Alimentação
            "ShoppingCart", "ShoppingBag", "Coffee", "Utensils", "UtensilsCrossed", "Pizza", "Apple",
            "Beef", "Croissant", "Fish", "Store", "Salad", "Soup", "Candy", "CandyCane",
            "Cherry", "Citrus", "Grape", "Milk", "Wine", "Beer", "Martini", "GlassWater",
            "IceCream", "Cake", "Cookie", "Donut", "Egg", "Sandwich", "Carrot", "Banana",
            # Casa e Transporte
            "Home", "Building", "Building2", "Car", "Bus", "Train", "Plane", "Bike",
            "Fuel", "ParkingCircle", "Ship", "Truck", "Ambulance", "Rocket",
            "Warehouse", "Factory", "Hotel", "Church", "TreePine", "Trees", "Flower",
            "Sofa", "Bed", "Armchair", "Lamp", "LampDesk", "Bath", "ShowerHead",
            "DoorOpen", "DoorClosed", "Fence", "Drill", "PaintBucket",
            # Tecnologia
            "Smartphone", "Laptop", "Monitor", "Tv", "Gamepad", "Gamepad2", "Music",
            "Film", "Camera", "Image", "Book", "BookOpen", "Newspaper", "FileText",
            "Wifi", "Youtube", "Video", "Bot", "Layout", "Palette", "Headphones",
            "Mic", "Radio", "Speaker", "Usb", "HardDrive", "Database", "Server",
            "Cloud", "Download", "Upload", "Bluetooth",
            "Cast", "Cpu", "MemoryStick", "Printer", "ScanLine", "Keyboard", "Mouse",
            # Finanças
            "DollarSign", "CreditCard", "Wallet", "PiggyBank", "TrendingUp", "TrendingDown",
            "Banknote", "Receipt", "Percent", "Coins", "CircleDollarSign", "BadgeDollarSign",
            "Calculator", "BarChart", "LineChart",
            "PieChart", "ArrowUpCircle", "ArrowDownCircle", "BadgePercent",
            # Trabalho e Produtividade
            "Activity", "BarChart", "PieChart", "Package", "Gift", "Award",
            "Briefcase", "Calendar", "Clock", "MapPin", "Globe", "Zap",
            "ClipboardList", "ClipboardCheck", "FileCheck", "FilePlus", "FileEdit",
            "Presentation", "Target", "Trophy", "Medal", "Crown",
            # Saúde e Bem-estar
            "Heart", "HeartPulse", "Pill", "Stethoscope", "Baby", "Brain", "Smile", "Ear",
            "Syringe", "Dumbbell", "PersonStanding", "Dog", "Cat", "Footprints",
            "Eye", "EyeOff", "Thermometer", "Accessibility", "Bone", "Rabbit",
            # Natureza e Clima
            "Droplet", "Droplets", "Flame", "Wind", "Cloud", "Sun", "Moon", "Waves",
            "Leaf", "Sprout", "TreeDeciduous", "TreePine", "Flower2", "Bug", "Bird",
            "Snowflake", "CloudRain", "CloudSnow", "CloudSun", "Sunrise", "Sunset",
            "Rainbow", "Palmtree", "Mountain", "Tent", "Compass", "Squirrel", "Fish",
            # Vestuário e Acessórios
            "Umbrella", "Shirt", "Watch", "Glasses", "Scissors", "Gem", "Sparkles",
            "ShoppingBasket", "Footprints", "Baby",
            # Ferramentas e Configurações
            "Wrench", "Settings", "Sliders", "Filter", "Search", "Bell",
            "Hammer", "Paintbrush", "Plug", "Zap", "Lock", "Unlock", "Key",
            "BellRing", "Cog", "SlidersHorizontal",
            # Comunicação e Pessoas
            "Mail", "MessageCircle", "Phone", "Users", "User", "UserPlus",
            "MailOpen", "Send", "Inbox", "Archive", "MessageSquare", "PhoneCall",
            "Voicemail", "AtSign", "Hash", "Share", "Share2", "ThumbsUp", "ThumbsDown",
            "UserCircle", "UserCheck", "UserMinus", "UserX",
            # Educação e Trabalho
            "GraduationCap", "School", "Backpack", "Pencil", "Pen", "PenTool",
            "BookMarked", "Library", "Ruler", "Eraser", "Highlighter",
            # Governo e Legal
            "Landmark", "FileCheck", "Scale", "Shield", "ShieldCheck", "ShieldAlert",
            "BadgeCheck", "BadgeAlert", "BadgeInfo",
            # Lazer e Entretenimento
            "PartyPopper", "Gift", "Cake", "IceCream", "Popcorn", "Clapperboard", "Trophy",
            "Medal", "Target", "Zap", "Flame", "Palmtree", "Mountain", "Waves", "Tent",
            "Compass", "Map", "Navigation", "Anchor", "Sailboat", "Puzzle",
            # Brinquedos e Kids
            "Baby", "Puzzle", "Gamepad", "Gamepad2",
            "Dice1", "Dice2", "Dice3", "Dice4", "Dice5", "Dice6", "Dices",
            "Rocket", "Plane", "Car", "Bike", "Bird", "Bug", "Fish", "Rabbit",
            "Dog", "Cat", "Squirrel", "Bone", "Smile", "Heart", "Star",
            "Sparkles", "Rainbow", "Sun", "Moon", "Cloud", "Snowflake",
            # Empresas e Serviços
            "Store", "ShoppingBag", "ShoppingCart", "Building", "Building2", "Factory",
            "Warehouse", "Hotel", "Landmark", "School", "Library",
            "Church", "Fuel", "ParkingCircle", "Truck", "Package", "Package2",
            "Box", "Archive", "Briefcase", "CreditCard", "Receipt", "Calculator",
            # Coisas Mundanas
            "Coffee", "Utensils", "Pizza", "Milk", "Egg", "Sandwich",
            "Shirt", "Scissors", "Umbrella", "Watch", "Glasses",
            "Key", "Lock", "Unlock", "DoorOpen", "DoorClosed", "Lamp", "LampDesk",
            "Sofa", "Bed", "Armchair", "Bath", "ShowerHead", "Trash", "Trash2",
            "Droplets", "Flame", "Plug", "Lightbulb",
            "Phone", "Smartphone", "Tv", "Radio", "Newspaper", "Book", "Pencil",
            # Formas e Símbolos
            "Shapes", "Circle", "Square", "Triangle", "Hexagon", "Octagon", "Pentagon",
            # Diversos
            "HelpCircle", "AlertTriangle", "AlertCircle", "XCircle", "Ticket",
            "Sparkles", "Lightbulb", "RotateCcw", "RefreshCw", "PartyPopper",
            "Trash", "Trash2", "Box", "Package2", "Archive", "Inbox",
            "CheckCircle", "CheckCircle2", "XCircle", "Info", "AlertOctagon"
        ]

        icons_json = '["' + '", "'.join(available_icons) + '"]'

        cursor.execute("""
            INSERT INTO system_settings (
                tenant_id, setting_key, setting_value, setting_type, description,
                active, created_at, last_updated_at
            )
            VALUES (
                1, 'available_icons', %s, 'json',
                'Lista de ícones disponíveis do lucide-react para tags e subtags',
                TRUE, NOW(), NOW()
            );
        """, (icons_json,))

        print(f"✅ Lista de {len(available_icons)} ícones disponíveis criada")

        # Mapeamento de ícones para nomes em português
        icon_names_pt = {
            # Básicos
            "Tag": "Etiqueta", "Tags": "Etiquetas", "Folder": "Pasta", "FolderOpen": "Pasta Aberta",
            "Bookmark": "Marcador", "Star": "Estrela", "Heart": "Coração",
            # Compras e Alimentação
            "ShoppingCart": "Carrinho", "ShoppingBag": "Sacola", "Coffee": "Café",
            "Utensils": "Talheres", "UtensilsCrossed": "Talheres Cruzados", "Pizza": "Pizza",
            "Apple": "Maçã", "Beef": "Carne", "Croissant": "Croissant", "Fish": "Peixe",
            "Store": "Loja", "Salad": "Salada", "Soup": "Sopa", "Candy": "Doce",
            "CandyCane": "Bengala Doce", "Cherry": "Cereja", "Citrus": "Cítrico",
            "Grape": "Uva", "Milk": "Leite", "Wine": "Vinho", "Beer": "Cerveja",
            "Martini": "Martini", "GlassWater": "Copo d'Água", "IceCream": "Sorvete",
            "Cake": "Bolo", "Cookie": "Biscoito", "Donut": "Rosquinha", "Egg": "Ovo",
            "Sandwich": "Sanduíche", "Carrot": "Cenoura", "Banana": "Banana",
            # Casa e Transporte
            "Home": "Casa", "Building": "Prédio", "Building2": "Edifício", "Car": "Carro",
            "Bus": "Ônibus", "Train": "Trem", "Plane": "Avião", "Bike": "Bicicleta",
            "Fuel": "Combustível", "ParkingCircle": "Estacionamento", "Ship": "Navio",
            "Truck": "Caminhão", "Ambulance": "Ambulância", "Rocket": "Foguete",
            "Warehouse": "Armazém", "Factory": "Fábrica", "Hotel": "Hotel", "Church": "Igreja",
            "TreePine": "Pinheiro", "Trees": "Árvores", "Flower": "Flor", "Flower2": "Flor 2",
            "Sofa": "Sofá", "Bed": "Cama", "Armchair": "Poltrona", "Lamp": "Luminária",
            "LampDesk": "Abajur", "Bath": "Banheira", "ShowerHead": "Chuveiro",
            "DoorOpen": "Porta Aberta", "DoorClosed": "Porta Fechada", "Fence": "Cerca",
            "Drill": "Furadeira", "PaintBucket": "Balde de Tinta",
            # Tecnologia
            "Smartphone": "Celular", "Laptop": "Notebook", "Monitor": "Monitor", "Tv": "TV",
            "Gamepad": "Controle", "Gamepad2": "Controle 2", "Music": "Música",
            "Film": "Filme", "Camera": "Câmera", "Image": "Imagem", "Book": "Livro",
            "BookOpen": "Livro Aberto", "Newspaper": "Jornal", "FileText": "Arquivo",
            "Wifi": "Wi-Fi", "Youtube": "YouTube", "Video": "Vídeo", "Bot": "Robô",
            "Layout": "Layout", "Palette": "Paleta", "Headphones": "Fones",
            "Mic": "Microfone", "Radio": "Rádio", "Speaker": "Alto-falante",
            "Usb": "USB", "HardDrive": "HD", "Database": "Banco de Dados", "Server": "Servidor",
            "Cloud": "Nuvem",
            "Download": "Download", "Upload": "Upload", "Bluetooth": "Bluetooth",
            "Cast": "Transmitir", "Cpu": "Processador", "MemoryStick": "Pen Drive",
            "Printer": "Impressora", "ScanLine": "Scanner", "Keyboard": "Teclado", "Mouse": "Mouse",
            # Finanças
            "DollarSign": "Cifrão", "CreditCard": "Cartão", "Wallet": "Carteira",
            "PiggyBank": "Cofrinho", "TrendingUp": "Alta", "TrendingDown": "Baixa",
            "Banknote": "Nota", "Receipt": "Recibo", "Percent": "Porcentagem",
            "Coins": "Moedas", "CircleDollarSign": "Cifrão Círculo", "BadgeDollarSign": "Distintivo Cifrão",
            "Calculator": "Calculadora", "BarChart": "Gráfico Barras", "LineChart": "Gráfico Linhas",
            "PieChart": "Gráfico Pizza", "ArrowUpCircle": "Seta Cima", "ArrowDownCircle": "Seta Baixo",
            "BadgePercent": "Distintivo Porcentagem",
            # Trabalho e Produtividade
            "Activity": "Atividade", "Package": "Pacote", "Gift": "Presente", "Award": "Prêmio",
            "Briefcase": "Maleta", "Calendar": "Calendário", "Clock": "Relógio",
            "MapPin": "Localização", "Globe": "Globo", "Zap": "Raio",
            "ClipboardList": "Lista", "ClipboardCheck": "Lista Checada", "FileCheck": "Arquivo Checado",
            "FilePlus": "Adicionar Arquivo", "FileEdit": "Editar Arquivo",
            "Presentation": "Apresentação", "Target": "Alvo", "Trophy": "Troféu",
            "Medal": "Medalha", "Crown": "Coroa",
            # Saúde e Bem-estar
            "HeartPulse": "Batimento", "Pill": "Pílula", "Stethoscope": "Estetoscópio",
            "Baby": "Bebê", "Brain": "Cérebro", "Smile": "Sorriso", "Ear": "Orelha",
            "Syringe": "Seringa", "Dumbbell": "Haltere", "PersonStanding": "Pessoa",
            "Dog": "Cachorro", "Cat": "Gato", "Footprints": "Pegadas",
            "Eye": "Olho", "EyeOff": "Olho Fechado", "Thermometer": "Termômetro",
            "Accessibility": "Acessibilidade", "Bone": "Osso", "Rabbit": "Coelho",
            # Natureza e Clima
            "Droplet": "Gota", "Droplets": "Gotas", "Flame": "Chama", "Wind": "Vento",
            "Sun": "Sol", "Moon": "Lua", "Waves": "Ondas", "Leaf": "Folha",
            "Sprout": "Broto", "TreeDeciduous": "Árvore", "Bug": "Inseto", "Bird": "Pássaro",
            "Snowflake": "Floco de Neve", "CloudRain": "Chuva", "CloudSnow": "Neve",
            "CloudSun": "Sol e Nuvem", "Sunrise": "Nascer do Sol", "Sunset": "Pôr do Sol",
            "Rainbow": "Arco-íris", "Palmtree": "Palmeira", "Mountain": "Montanha",
            "Tent": "Barraca", "Compass": "Bússola", "Squirrel": "Esquilo",
            # Vestuário e Acessórios
            "Umbrella": "Guarda-chuva", "Shirt": "Camisa", "Watch": "Relógio",
            "Glasses": "Óculos", "Scissors": "Tesoura", "Gem": "Joia",
            "Sparkles": "Brilhos", "ShoppingBasket": "Cesta",
            # Ferramentas e Configurações
            "Wrench": "Chave Inglesa", "Settings": "Configurações",
            "Sliders": "Controles", "Filter": "Filtro", "Search": "Buscar", "Bell": "Sino",
            "Hammer": "Martelo", "Paintbrush": "Pincel", "Plug": "Tomada",
            "Lock": "Cadeado", "Unlock": "Destrancado", "Key": "Chave",
            "BellRing": "Sino Tocando", "Cog": "Engrenagem", "SlidersHorizontal": "Controles Horizontais",
            # Comunicação e Pessoas
            "Mail": "Email", "MessageCircle": "Mensagem", "Phone": "Telefone",
            "Users": "Usuários", "User": "Usuário", "UserPlus": "Adicionar Usuário",
            "MailOpen": "Email Aberto", "Send": "Enviar", "Inbox": "Caixa de Entrada",
            "Archive": "Arquivo", "MessageSquare": "Mensagem Quadrada", "PhoneCall": "Chamada",
            "Voicemail": "Correio de Voz", "AtSign": "Arroba", "Hash": "Hashtag",
            "Share": "Compartilhar", "Share2": "Compartilhar 2", "ThumbsUp": "Curtir",
            "ThumbsDown": "Não Curtir", "UserCircle": "Usuário Círculo", "UserCheck": "Usuário Checado",
            "UserMinus": "Remover Usuário", "UserX": "Usuário X",
            # Educação e Trabalho
            "GraduationCap": "Formatura", "School": "Escola", "Backpack": "Mochila",
            "Pencil": "Lápis", "Pen": "Caneta", "PenTool": "Caneta Ferramenta",
            "BookMarked": "Livro Marcado", "Library": "Biblioteca", "Ruler": "Régua",
            "Eraser": "Borracha", "Highlighter": "Marca-texto",
            # Governo e Legal
            "Landmark": "Marco", "Scale": "Balança", "Shield": "Escudo",
            "ShieldCheck": "Escudo Checado", "ShieldAlert": "Escudo Alerta",
            "BadgeCheck": "Distintivo Checado", "BadgeAlert": "Distintivo Alerta",
            "BadgeInfo": "Distintivo Info",
            # Lazer e Entretenimento
            "PartyPopper": "Festa", "Popcorn": "Pipoca", "Clapperboard": "Claquete",
            "Map": "Mapa", "Navigation": "Navegação", "Anchor": "Âncora",
            "Sailboat": "Veleiro", "Puzzle": "Quebra-cabeça",

            # Formas e Símbolos
            "Shapes": "Formas", "Circle": "Círculo", "Square": "Quadrado",
            "Triangle": "Triângulo", "Hexagon": "Hexágono", "Octagon": "Octógono",
            "Pentagon": "Pentágono", "Dice1": "Dado 1", "Dice2": "Dado 2",
            "Dice3": "Dado 3", "Dice4": "Dado 4", "Dice5": "Dado 5",
            "Dice6": "Dado 6", "Dices": "Dados",
            # Diversos
            "HelpCircle": "Ajuda", "AlertTriangle": "Alerta Triângulo", "AlertCircle": "Alerta Círculo",
            "XCircle": "X Círculo", "Ticket": "Ingresso", "Lightbulb": "Lâmpada",
            "RotateCcw": "Rotacionar", "RefreshCw": "Atualizar", "Box": "Caixa",
            "Package2": "Pacote 2", "Trash": "Lixo", "Trash2": "Lixeira",
            "CheckCircle": "Check Círculo", "CheckCircle2": "Check Círculo 2",
            "Info": "Informação", "AlertOctagon": "Alerta Octógono"
        }

        icon_names_json = json.dumps(icon_names_pt, ensure_ascii=False)

        cursor.execute("""
            INSERT INTO system_settings (
                tenant_id, setting_key, setting_value, setting_type, description,
                active, created_at, last_updated_at
            )
            VALUES (
                1, 'icon_names_pt', %s, 'json',
                'Mapeamento de ícones para nomes em português',
                TRUE, NOW(), NOW()
            );
        """, (icon_names_json,))

        print(f"✅ Mapeamento de {len(icon_names_pt)} nomes de ícones em português criado")

        connection.commit()
        print("✅ Migration 0002: Seed Data Inicial aplicada com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao aplicar migration: {e}")
        raise

def rollback(connection):
    """Reverte a migration de seed data."""
    print("🔄 Revertendo Migration 0002: Seed Data Inicial")

    cursor = connection.cursor()

    try:
        print("📋 Removendo dados...")

        # ORDEM DE DELEÇÃO (do mais dependente para o menos dependente):
        # 1. balance_closure_items (referencia balance_closures)
        # 2. balance_closures (referencia users)
        # 3. Tabelas que referenciam subtags e credit_cards
        # 4. expense_template_items (referencia expense_templates e subtags)
        # 5. expense_templates
        # 6. transaction_mappings (referencia subtags)
        # 7. subtags (referencia tags)
        # 8. tags
        # 9. credit_cards
        # 10. expense_sharing_settings
        # 11. accounts
        # 12. users_permissions
        # 13. users
        # 14. tenants

        # Remove balance_closure_items (referencia balance_closures)
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'balance_closure_items'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM balance_closure_items WHERE tenant_id = 1;")

        # Remove balance_closures (referencia users)
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'balance_closures'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM balance_closures WHERE tenant_id = 1;")

        # Remove registros que referenciam subtags e/ou credit_cards
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'bank_statements'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM bank_statements WHERE tenant_id = 1;")

        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'credit_card_invoices'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM credit_card_invoices WHERE tenant_id = 1;")

        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'benefit_card_statements'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM benefit_card_statements WHERE tenant_id = 1;")

        # Remove expense_template_items (referencia expense_templates e subtags)
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'expense_template_items'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM expense_template_items WHERE tenant_id = 1;")

        # Remove expense_templates
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'expense_templates'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM expense_templates WHERE tenant_id = 1;")

        # Remove transaction_mappings (referencia subtags)
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'transaction_mappings'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM transaction_mappings WHERE tenant_id = 1;")

        # Remove subtags (referencia tags)
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'subtags'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM subtags WHERE tenant_id = 1;")

        # Remove tags
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'tags'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM tags WHERE tenant_id = 1;")

        # Remove cartões de crédito
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'credit_cards'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM credit_cards WHERE tenant_id = 1;")

        # Remove expense_sharing_settings
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'expense_sharing_settings'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM expense_sharing_settings WHERE tenant_id = 1;")

        # Remove contas
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'accounts'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM accounts WHERE tenant_id = 1;")

        # Remove permissões do usuário admin
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'users_permissions'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM users_permissions WHERE tenant_id = 1;")

        # Remove usuário admin
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'users'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM users WHERE tenant_id = 1;")

        # Remove tenant
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'tenants'
            );
        """)
        result = cursor.fetchone()
        if result and result['exists']:
            cursor.execute("DELETE FROM tenants WHERE id = 1;")

        print("✅ Dados removidos")

        connection.commit()
        print("✅ Migration 0002: Seed Data Inicial revertida com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration: {e}")
        raise

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0002: Seed Data Inicial')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    try:
        if args.rollback:
            rollback(conn)
        else:
            apply(conn)
    finally:
        conn.close()

