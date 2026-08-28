'use client';

/**
 * AngoStart — Mapeamento de nomes de ícones (guardados na BD) para
 * componentes lucide-react, com fallback seguro.
 */

import {
  AirVent,
  BatteryCharging,
  BookOpen,
  Code2,
  Globe,
  GraduationCap,
  Headphones,
  Home,
  LayoutTemplate,
  Package,
  Palette,
  Share2,
  Smartphone,
  Sparkles,
  Wind,
  Wrench,
  Zap,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  'air-vent': AirVent,
  'battery-charging': BatteryCharging,
  'book-open': BookOpen,
  'code-2': Code2,
  globe: Globe,
  'graduation-cap': GraduationCap,
  headphones: Headphones,
  home: Home,
  'layout-template': LayoutTemplate,
  package: Package,
  palette: Palette,
  'share-2': Share2,
  smartphone: Smartphone,
  sparkles: Sparkles,
  wind: Wind,
  wrench: Wrench,
  zap: Zap,
};

export default function ProductIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICON_MAP[name] ?? ShoppingBag;
  return <Icon className={className} aria-hidden="true" />;
}
