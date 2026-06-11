"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { addDays, format, isSameDay, isToday } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Slot } from "radix-ui";
import {
  type ButtonHTMLAttributes,
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
  useContext,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Context for sharing state between components
type MiniCalendarContextType = {
  selectedDate: Date | null | undefined;
  onDateSelect: (date: Date) => void;
  startDate: Date;
  onNavigate: (direction: "prev" | "next") => void;
  days: number;
};

const MiniCalendarContext = createContext<MiniCalendarContextType | null>(null);

const useMiniCalendar = () => {
  const context = useContext(MiniCalendarContext);

  if (!context) {
    throw new Error("MiniCalendar components must be used within MiniCalendar");
  }

  return context;
};

// Helper function to get array of consecutive dates
const getDays = (startDate: Date, count: number): Date[] => {
  const days: Date[] = [];
  for (let i = 0; i < count; i++) {
    days.push(addDays(startDate, i));
  }
  return days;
};

// Helper function to format date
const formatDate = (date: Date) => {
  const weekday = format(date, "EEE", { locale: es });
  const month = format(date, "MMM", { locale: es });
  const day = format(date, "d");

  return { weekday, month, day };
};

export type MiniCalendarProps = HTMLAttributes<HTMLDivElement> & {
  value?: Date;
  defaultValue?: Date;
  onValueChange?: (date: Date | undefined) => void;
  startDate?: Date;
  defaultStartDate?: Date;
  onStartDateChange?: (date: Date | undefined) => void;
  days?: number;
};

export const MiniCalendar = ({
  value,
  defaultValue,
  onValueChange,
  startDate,
  defaultStartDate = new Date(),
  onStartDateChange,
  days = 5,
  className,
  children,
  ...props
}: MiniCalendarProps) => {
  const [selectedDate, setSelectedDate] = useControllableState<
    Date | undefined
  >({
    prop: value,
    defaultProp: defaultValue,
    onChange: onValueChange,
  });

  const [currentStartDate, setCurrentStartDate] = useControllableState({
    prop: startDate,
    defaultProp: defaultStartDate,
    onChange: onStartDateChange,
  });

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
  };

  const handleNavigate = (direction: "prev" | "next") => {
    const newStartDate = addDays(
      currentStartDate || new Date(),
      direction === "next" ? days : -days
    );
    setCurrentStartDate(newStartDate);
  };

  const contextValue: MiniCalendarContextType = {
    selectedDate: selectedDate || null,
    onDateSelect: handleDateSelect,
    startDate: currentStartDate || new Date(),
    onNavigate: handleNavigate,
    days,
  };

  return (
    <MiniCalendarContext.Provider value={contextValue}>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-border bg-surface p-1.5",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </MiniCalendarContext.Provider>
  );
};

export type MiniCalendarNavigationProps =
  ButtonHTMLAttributes<HTMLButtonElement> & {
    direction: "prev" | "next";
    asChild?: boolean;
  };

export const MiniCalendarNavigation = ({
  direction,
  asChild = false,
  children,
  onClick,
  ...props
}: MiniCalendarNavigationProps) => {
  const { onNavigate } = useMiniCalendar();
  const Icon = direction === "prev" ? ChevronLeftIcon : ChevronRightIcon;

  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    onNavigate(direction);
    onClick?.(event);
  };

  if (asChild) {
    return (
      <Slot.Root onClick={handleClick} {...props}>
        {children}
      </Slot.Root>
    );
  }

  return (
    <Button
      onClick={handleClick}
      size={asChild ? undefined : "icon"}
      type="button"
      variant={asChild ? undefined : "ghost"}
      {...props}
    >
      {children ?? <Icon className="size-4" />}
    </Button>
  );
};

export type MiniCalendarDaysProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> & {
  children: (date: Date) => ReactNode;
};

export const MiniCalendarDays = ({
  className,
  children,
  ...props
}: MiniCalendarDaysProps) => {
  const { startDate, days: dayCount } = useMiniCalendar();
  const days = getDays(startDate, dayCount);

  return (
    <div
      className={cn("flex w-full flex-1 items-stretch gap-1", className)}
      {...props}
    >
      {days.map((date) => children(date))}
    </div>
  );
};

export type MiniCalendarDayProps = ComponentProps<typeof Button> & {
  date: Date;
};

export const MiniCalendarDay = ({
  date,
  className,
  disabled,
  ...props
}: MiniCalendarDayProps) => {
  const { selectedDate, onDateSelect } = useMiniCalendar();
  const { weekday, day } = formatDate(date);
  const isSelected = selectedDate && isSameDay(date, selectedDate);
  const isTodayDate = isToday(date);
  const isAvailable = !disabled;

  return (
    <Button
      className={cn(
        "h-auto min-w-0 flex-1 flex-col gap-1 px-1 py-2.5 text-xs",
        // Today (when not selected): a thin lit ring instead of a heavy fill.
        isTodayDate &&
          !isSelected &&
          "ring-1 ring-inset ring-border-strong",
        // Unavailable days read as muted, not just dimmed by the disabled state.
        disabled && "opacity-30",
        className
      )}
      onClick={() => onDateSelect(date)}
      size="sm"
      type="button"
      variant={isSelected ? "default" : "ghost"}
      disabled={disabled}
      {...props}
    >
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wider text-fg-faint",
          isTodayDate && !isSelected && "text-accent",
          isSelected && "text-primary-foreground/75"
        )}
      >
        {weekday}
      </span>
      <span className="font-mono text-sm font-semibold tabular-nums">{day}</span>
      {/* Availability affordance — paired with the disabled/opacity state above,
          never color alone. */}
      <span
        aria-hidden="true"
        className={cn(
          "h-1 w-1 rounded-full transition-colors",
          isAvailable && !isSelected ? "bg-accent" : "bg-transparent"
        )}
      />
    </Button>
  );
};
