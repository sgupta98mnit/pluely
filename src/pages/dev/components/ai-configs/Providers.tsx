import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Header,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Selection,
  TextInput,
} from "@/components";
import { UseSettingsReturn } from "@/types";
import curl2Json, { ResultJSON } from "@bany/curl-to-json";
import { Check, ChevronDown, KeyIcon, TrashIcon } from "lucide-react";
import { useEffect, useState } from "react";

const MODEL_VARIABLE_KEY = "model";

/**
 * Searchable model picker: shows the provider's curated popular models and lets
 * the user filter or enter any custom model (custom fallback). Used in place of
 * the plain text input when the selected provider has a non-empty `models` list.
 */
const ModelCombobox = ({
  models,
  value,
  onChange,
  providerLabel,
}: {
  models: string[];
  value: string;
  onChange: (value: string) => void;
  providerLabel: string;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const trimmedSearch = search.trim();
  const showCustomOption =
    trimmedSearch !== "" && !models.includes(trimmedSearch);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setSearch("");
  };

  const handleSelect = (model: string) => {
    onChange(model);
    setOpen(false);
    setSearch("");
  };

  return (
    <div className="space-y-2">
      <Header
        title="Model"
        description={`Select a model for ${providerLabel}, or type to use a custom model.`}
      />
      <Popover modal={true} open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          asChild
          className="cursor-pointer flex justify-start"
        >
          <Button
            variant="outline"
            className="h-11 text-start shadow-none w-full font-normal"
          >
            <span className={value ? "" : "text-muted-foreground"}>
              {value || "Select a model"}
            </span>
            <ChevronDown className="ml-auto" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-[var(--radix-popover-trigger-width)] p-0 rounded-xl overflow-hidden"
        >
          <Command shouldFilter={true}>
            <CommandInput
              placeholder="Search or type a model..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-72 rounded-xl overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-muted [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/30">
              <CommandEmpty>No models found.</CommandEmpty>
              <CommandGroup>
                {models.map((model) => (
                  <CommandItem
                    key={model}
                    value={model}
                    className="cursor-pointer"
                    onSelect={() => handleSelect(model)}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${
                        value === model ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    {model}
                  </CommandItem>
                ))}
                {showCustomOption && (
                  <CommandItem
                    key={`__custom__${trimmedSearch}`}
                    value={trimmedSearch}
                    className="cursor-pointer"
                    onSelect={() => handleSelect(trimmedSearch)}
                  >
                    <Check className="mr-2 h-4 w-4 opacity-0" />
                    Use "{trimmedSearch}"
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export const Providers = ({
  allAiProviders,
  selectedAIProvider,
  onSetSelectedAIProvider,
  variables,
}: UseSettingsReturn) => {
  const [localSelectedProvider, setLocalSelectedProvider] =
    useState<ResultJSON | null>(null);

  useEffect(() => {
    if (selectedAIProvider?.provider) {
      const provider = allAiProviders?.find(
        (p) => p?.id === selectedAIProvider?.provider
      );
      if (provider) {
        const json = curl2Json(provider?.curl);
        setLocalSelectedProvider(json as ResultJSON);
      }
    }
  }, [selectedAIProvider?.provider]);

  const findKeyAndValue = (key: string) => {
    return variables?.find((v) => v?.key === key);
  };

  const getApiKeyValue = () => {
    const apiKeyVar = findKeyAndValue("api_key");
    if (!apiKeyVar || !selectedAIProvider?.variables) return "";
    return selectedAIProvider?.variables?.[apiKeyVar.key] || "";
  };

  const isApiKeyEmpty = () => {
    return !getApiKeyValue().trim();
  };

  const currentProvider = allAiProviders?.find(
    (p) => p?.id === selectedAIProvider?.provider
  );
  const curatedModels = currentProvider?.models ?? [];
  const modelVar = findKeyAndValue(MODEL_VARIABLE_KEY);
  const hasModelDropdown = !!modelVar && curatedModels.length > 0;
  const providerLabel = currentProvider?.isCustom
    ? "Custom Provider"
    : selectedAIProvider?.provider ?? "";

  const getModelValue = () =>
    selectedAIProvider?.variables?.[MODEL_VARIABLE_KEY] || "";

  const setModelValue = (value: string) => {
    if (!modelVar || !selectedAIProvider) return;
    onSetSelectedAIProvider({
      ...selectedAIProvider,
      variables: {
        ...selectedAIProvider.variables,
        [modelVar.key]: value,
      },
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Header
          title="Select AI Provider"
          description="Select your preferred AI service provider or custom providers to get started."
        />
        <Selection
          selected={selectedAIProvider?.provider}
          options={allAiProviders?.map((provider) => {
            const json = curl2Json(provider?.curl);
            return {
              label: provider?.isCustom
                ? json?.url || "Custom Provider"
                : provider?.id || "Custom Provider",
              value: provider?.id || "Custom Provider",
              isCustom: provider?.isCustom,
            };
          })}
          placeholder="Choose your AI provider"
          onChange={(value) => {
            onSetSelectedAIProvider({
              provider: value,
              variables: {},
            });
          }}
        />
      </div>

      {localSelectedProvider ? (
        <Header
          title={`Method: ${
            localSelectedProvider?.method || "Invalid"
          }, Endpoint: ${localSelectedProvider?.url || "Invalid"}`}
          description={`If you want to use different url or method, you can always create a custom provider.`}
        />
      ) : null}

      {findKeyAndValue("api_key") ? (
        <div className="space-y-2">
          <Header
            title="API Key"
            description={`Enter your ${
              allAiProviders?.find(
                (p) => p?.id === selectedAIProvider?.provider
              )?.isCustom
                ? "Custom Provider"
                : selectedAIProvider?.provider
            } API key to authenticate and access AI models. Your key is stored locally and never shared.`}
          />

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="**********"
                value={getApiKeyValue()}
                onChange={(value) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]:
                        typeof value === "string" ? value : value.target.value,
                    },
                  });
                }}
                onKeyDown={(e) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]: (e.target as HTMLInputElement).value,
                    },
                  });
                }}
                disabled={false}
                className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
              />
              {isApiKeyEmpty() ? (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider || isApiKeyEmpty())
                      return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: getApiKeyValue(),
                      },
                    });
                  }}
                  disabled={isApiKeyEmpty()}
                  size="icon"
                  className="shrink-0 h-11 w-11"
                  title="Submit API Key"
                >
                  <KeyIcon className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider) return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: "",
                      },
                    });
                  }}
                  size="icon"
                  variant="destructive"
                  className="shrink-0 h-11 w-11"
                  title="Remove API Key"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {hasModelDropdown ? (
        <ModelCombobox
          models={curatedModels}
          value={getModelValue()}
          onChange={setModelValue}
          providerLabel={providerLabel}
        />
      ) : null}

      <div className="space-y-4 mt-2">
        {variables
          .filter(
            (variable) =>
              variable.key !== findKeyAndValue("api_key")?.key &&
              !(hasModelDropdown && variable.key === MODEL_VARIABLE_KEY)
          )
          .map((variable) => {
            const getVariableValue = () => {
              if (!variable?.key || !selectedAIProvider?.variables) return "";
              return selectedAIProvider.variables[variable.key] || "";
            };

            return (
              <div className="space-y-1" key={variable?.key}>
                <Header
                  title={variable?.value || ""}
                  description={`add your preferred ${variable?.key?.replace(
                    /_/g,
                    " "
                  )} for ${
                    allAiProviders?.find(
                      (p) => p?.id === selectedAIProvider?.provider
                    )?.isCustom
                      ? "Custom Provider"
                      : selectedAIProvider?.provider
                  }`}
                />
                <TextInput
                  placeholder={`Enter ${
                    allAiProviders?.find(
                      (p) => p?.id === selectedAIProvider?.provider
                    )?.isCustom
                      ? "Custom Provider"
                      : selectedAIProvider?.provider
                  } ${variable?.key?.replace(/_/g, " ") || "value"}`}
                  value={getVariableValue()}
                  onChange={(value) => {
                    if (!variable?.key || !selectedAIProvider) return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [variable.key]: value,
                      },
                    });
                  }}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
};
