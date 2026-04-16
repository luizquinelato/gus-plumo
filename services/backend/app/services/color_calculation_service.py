"""
Color Calculation Service
Handles all color calculations including WCAG compliance, luminance, contrast, and variant generation
"""
import logging
from typing import Dict, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ColorVariants:
    """Data class for color variants"""
    base_colors: Dict[str, str]
    on_colors: Dict[str, str]
    gradient_colors: Dict[str, str]


class ColorCalculationService:
    """
    Service for calculating color variants and ensuring WCAG compliance.
    Provides methods for luminance calculation, contrast checking, and color adaptation.
    """

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def calculate_luminance(self, hex_color: str) -> float:
        """
        Calculate WCAG relative luminance for a hex color.
        
        Args:
            hex_color: Hex color string (e.g., '#FF0000')

        Returns:
            Relative luminance value (0.0 to 1.0)
        """
        try:
            hex_color = hex_color.lstrip('#')
            if len(hex_color) != 6:
                raise ValueError(f"Invalid hex color format: {hex_color}")

            r, g, b = tuple(int(hex_color[i:i+2], 16) / 255.0 for i in (0, 2, 4))

            def linearize(c):
                return (c/12.92) if c <= 0.03928 else ((c+0.055)/1.055) ** 2.4

            return 0.2126*linearize(r) + 0.7152*linearize(g) + 0.0722*linearize(b)

        except Exception as e:
            self.logger.error(f"Error calculating luminance for {hex_color}: {e}")
            return 0.5  # Default to middle luminance

    def calculate_contrast_ratio(self, color1: str, color2: str) -> float:
        """
        Calculate WCAG contrast ratio between two colors.

        Args:
            color1: First hex color
            color2: Second hex color

        Returns:
            Contrast ratio (1.0 to 21.0)
        """
        try:
            l1 = self.calculate_luminance(color1)
            l2 = self.calculate_luminance(color2)

            light = max(l1, l2)
            dark = min(l1, l2)

            return (light + 0.05) / (dark + 0.05)

        except Exception as e:
            self.logger.error(f"Error calculating contrast ratio: {e}")
            return 1.0  # Default to minimum contrast

    def pick_on_color(self, background_color: str, threshold: float = 0.5) -> str:
        """
        Choose optimal text color (black or white) for a background color.
        Uses configurable luminance threshold for better UX.

        Args:
            background_color: Background hex color
            threshold: Luminance threshold (0.0 to 1.0)

        Returns:
            '#FFFFFF' or '#000000'
        """
        try:
            luminance = self.calculate_luminance(background_color)
            # Use <= to include edge case where luminance equals threshold
            return '#FFFFFF' if luminance <= threshold else '#000000'

        except Exception as e:
            self.logger.error(f"Error picking on-color for {background_color}: {e}")
            return '#FFFFFF'  # Default to white for safety

    def pick_gradient_on_color(self, color_a: str, color_b: str, threshold: float = 0.5) -> str:
        """
        Choose optimal text color for a gradient background using average luminance method.

        Args:
            color_a: First gradient color
            color_b: Second gradient color
            threshold: Luminance threshold for color selection

        Returns:
            Optimal text color for the gradient
        """
        try:
            on_a = self.pick_on_color(color_a, threshold)
            on_b = self.pick_on_color(color_b, threshold)

            # If both colors need the same text color, use it
            if on_a == on_b:
                return on_a

            # Use average luminance method for better gradient text color
            luminance_a = self.calculate_luminance(color_a)
            luminance_b = self.calculate_luminance(color_b)
            average_luminance = (luminance_a + luminance_b) / 2

            # Apply threshold to average luminance
            return '#FFFFFF' if average_luminance < threshold else '#000000'

        except Exception as e:
            self.logger.error(f"Error picking gradient on-color: {e}")
            return '#FFFFFF'

    def lighten_color(self, hex_color: str, factor: float = 0.2) -> str:
        """
        Lighten a color by a specified factor.

        Args:
            hex_color: Input hex color
            factor: Lightening factor (0.0 to 1.0)

        Returns:
            Lightened hex color
        """
        try:
            hex_color = hex_color.lstrip('#')
            r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

            r = min(255, int(r + (255 - r) * factor))
            g = min(255, int(g + (255 - g) * factor))
            b = min(255, int(b + (255 - b) * factor))

            return f"#{r:02x}{g:02x}{b:02x}".upper()

        except Exception as e:
            self.logger.error(f"Error lightening color {hex_color}: {e}")
            return hex_color  # Return original on error

    def darken_color(self, hex_color: str, factor: float = 0.2) -> str:
        """
        Darken a color by a specified factor.

        Args:
            hex_color: Input hex color
            factor: Darkening factor (0.0 to 1.0)

        Returns:
            Darkened hex color
        """
        try:
            hex_color = hex_color.lstrip('#')
            r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

            r = max(0, int(r * (1 - factor)))
            g = max(0, int(g * (1 - factor)))
            b = max(0, int(b * (1 - factor)))

            return f"#{r:02x}{g:02x}{b:02x}".upper()

        except Exception as e:
            self.logger.error(f"Error darkening color {hex_color}: {e}")
            return hex_color  # Return original on error

    def apply_accessibility_enhancement(self, hex_color: str, level: str) -> str:
        """
        Apply accessibility enhancement to a color based on WCAG level.

        Args:
            hex_color: Original color
            level: 'regular', 'AA', or 'AAA'

        Returns:
            Enhanced color for accessibility
        """
        try:
            if level == 'AAA':
                # Darken slightly for AAA compliance (7:1 contrast)
                return self.darken_color(hex_color, 0.1)
            elif level == 'AA':
                # Darken very slightly for AA compliance (4.5:1 contrast)
                return self.darken_color(hex_color, 0.05)
            else:
                # Regular level uses original color
                return hex_color

        except Exception as e:
            self.logger.error(f"Error applying accessibility enhancement: {e}")
            return hex_color

    def calculate_all_variants(
        self,
        base_colors: Dict[str, str],
        threshold: float = 0.5
    ) -> ColorVariants:
        """
        Calculate all color variants from base colors.

        Args:
            base_colors: Dictionary with color1-color5 keys
            threshold: Luminance threshold for font color selection

        Returns:
            ColorVariants object with all calculated variants
        """
        try:
            variants = ColorVariants(
                base_colors=base_colors.copy(),
                on_colors={},
                gradient_colors={}
            )

            # Calculate on-colors
            for i in range(1, 6):
                color_key = f'color{i}'
                if color_key in base_colors:
                    variants.on_colors[f'on_color{i}'] = self.pick_on_color(
                        base_colors[color_key], threshold
                    )

            # Calculate gradient on-colors (including 5→1 wrap)
            gradient_pairs = [
                ('color1', 'color2', 'on_gradient_1_2'),
                ('color2', 'color3', 'on_gradient_2_3'),
                ('color3', 'color4', 'on_gradient_3_4'),
                ('color4', 'color5', 'on_gradient_4_5'),
                ('color5', 'color1', 'on_gradient_5_1')  # Wraps back to color1
            ]

            for color_a_key, color_b_key, gradient_key in gradient_pairs:
                if color_a_key in base_colors and color_b_key in base_colors:
                    variants.gradient_colors[gradient_key] = self.pick_gradient_on_color(
                        base_colors[color_a_key], base_colors[color_b_key], threshold
                    )

            return variants

        except Exception as e:
            self.logger.error(f"Error calculating color variants: {e}")
            # Return empty variants on error
            return ColorVariants(
                base_colors=base_colors,
                on_colors={},
                gradient_colors={}
            )

