DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CompanyDefinitionType') THEN
    CREATE TYPE "CompanyDefinitionType" AS ENUM ('CLASS_1', 'CLASS_2');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.company_definitions (
  id text PRIMARY KEY,
  "companyId" text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  type "CompanyDefinitionType" NOT NULL,
  label text NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS "classification1Id" text,
ADD COLUMN IF NOT EXISTS "classification2Id" text,
ADD COLUMN IF NOT EXISTS "authorizedUserId" text;

ALTER TABLE public.suppliers
ADD COLUMN IF NOT EXISTS "classification1Id" text,
ADD COLUMN IF NOT EXISTS "classification2Id" text,
ADD COLUMN IF NOT EXISTS "authorizedUserId" text;

CREATE UNIQUE INDEX IF NOT EXISTS company_definitions_companyId_type_label_key
ON public.company_definitions("companyId", type, label);

CREATE INDEX IF NOT EXISTS company_definitions_companyId_type_isActive_idx
ON public.company_definitions("companyId", type, "isActive");
CREATE INDEX IF NOT EXISTS customers_classification1Id_idx ON public.customers("classification1Id");
CREATE INDEX IF NOT EXISTS customers_classification2Id_idx ON public.customers("classification2Id");
CREATE INDEX IF NOT EXISTS customers_authorizedUserId_idx ON public.customers("authorizedUserId");
CREATE INDEX IF NOT EXISTS suppliers_classification1Id_idx ON public.suppliers("classification1Id");
CREATE INDEX IF NOT EXISTS suppliers_classification2Id_idx ON public.suppliers("classification2Id");
CREATE INDEX IF NOT EXISTS suppliers_authorizedUserId_idx ON public.suppliers("authorizedUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'customers_classification1Id_fkey'
  ) THEN
    ALTER TABLE public.customers
    ADD CONSTRAINT "customers_classification1Id_fkey"
    FOREIGN KEY ("classification1Id") REFERENCES public.company_definitions(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'customers_classification2Id_fkey'
  ) THEN
    ALTER TABLE public.customers
    ADD CONSTRAINT "customers_classification2Id_fkey"
    FOREIGN KEY ("classification2Id") REFERENCES public.company_definitions(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'customers_authorizedUserId_fkey'
  ) THEN
    ALTER TABLE public.customers
    ADD CONSTRAINT "customers_authorizedUserId_fkey"
    FOREIGN KEY ("authorizedUserId") REFERENCES public.users(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'suppliers_classification1Id_fkey'
  ) THEN
    ALTER TABLE public.suppliers
    ADD CONSTRAINT "suppliers_classification1Id_fkey"
    FOREIGN KEY ("classification1Id") REFERENCES public.company_definitions(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'suppliers_classification2Id_fkey'
  ) THEN
    ALTER TABLE public.suppliers
    ADD CONSTRAINT "suppliers_classification2Id_fkey"
    FOREIGN KEY ("classification2Id") REFERENCES public.company_definitions(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'suppliers_authorizedUserId_fkey'
  ) THEN
    ALTER TABLE public.suppliers
    ADD CONSTRAINT "suppliers_authorizedUserId_fkey"
    FOREIGN KEY ("authorizedUserId") REFERENCES public.users(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
