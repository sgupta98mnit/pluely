import { Button } from "@/components";
import { LaptopMinimalIcon, Loader2, MousePointer2Icon } from "lucide-react";
import { UseCompletionReturn } from "@/types";
import { MAX_FILES } from "@/config";
import { useApp } from "@/contexts";

export const Screenshot = ({
  screenshotConfiguration,
  attachedFiles,
  isLoading,
  captureScreenshot,
  isScreenshotLoading,
}: UseCompletionReturn) => {
  const { supportsImages } = useApp();
  const captureMode = screenshotConfiguration.enabled
    ? "Screenshot"
    : "Selection";
  const processingMode = screenshotConfiguration.mode;

  const isDisabled =
    attachedFiles.length >= MAX_FILES ||
    isLoading ||
    isScreenshotLoading ||
    !supportsImages;

  return (
    <Button
      size="default"
      className="cursor-pointer bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-primary-foreground shadow-sm transition-all duration-300 hover:scale-[1.02] px-3"
      title={
        !supportsImages
          ? "Screenshot not supported by current AI provider"
          : `${captureMode} mode (${processingMode}) - ${attachedFiles.length}/${MAX_FILES} files`
      }
      onClick={captureScreenshot}
      disabled={isDisabled}
    >
      {isScreenshotLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <>
          {screenshotConfiguration.enabled ? (
            <LaptopMinimalIcon className="h-4 w-4 mr-2" />
          ) : (
            <MousePointer2Icon className="h-4 w-4 mr-2" />
          )}
          <span className="font-medium text-xs">Ask AI</span>
        </>
      )}
    </Button>
  );
};

