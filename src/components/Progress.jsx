function formatBytes(size) {
  const i = size == 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
  return (
    +(size / Math.pow(1024, i)).toFixed(2) * 1 +
    ["B", "kB", "MB", "GB", "TB"][i]
  );
}

export default function Progress({ text, percentage, total }) {
  percentage ??= 0;
  return (
    <div className="w-full mb-1">
      <div className="flex justify-between text-xs text-dm-text-secondary mb-1">
        <span className="truncate mr-2">{text}</span>
        <span className="tabular-nums whitespace-nowrap">
          {percentage.toFixed(0)}%
          {isNaN(total) ? "" : ` of ${formatBytes(total)}`}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-dm-surface-high overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-dm-blue to-dm-green transition-all duration-300 ease-out relative"
          style={{ width: `${percentage}%` }}
        >
          <div className="absolute inset-0 bg-[length:200%_100%] bg-gradient-to-r from-transparent via-white/15 to-transparent animate-shimmer rounded-full" />
        </div>
      </div>
    </div>
  );
}
